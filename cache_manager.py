"""
Менеджер кэширования для внешних API запросов
Использует простой in-memory кэш с TTL и LRU eviction
"""
import time
import functools
from typing import Any, Optional, Callable
from collections import OrderedDict
from threading import Lock
from config import config
from logger_config import setup_logging

logger = setup_logging(__name__)


class CacheEntry:
    """Запись кэша с временем жизни"""
    def __init__(self, value, ttl):
        self.value = value
        self.expires_at = time.time() + ttl

    def is_expired(self):
        return time.time() > self.expires_at


class SimpleCache:
    """Простой thread-safe LRU кэш с TTL"""

    def __init__(self, max_size=1000):
        self.max_size = max_size
        self.cache = OrderedDict()
        self.lock = Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key):
        """Получить значение из кэша"""
        with self.lock:
            if key not in self.cache:
                self.misses += 1
                return None

            entry = self.cache[key]

            # Проверяем TTL
            if entry.is_expired():
                del self.cache[key]
                self.misses += 1
                logger.debug(f"Cache expired for key: {key}")
                return None

            # Перемещаем в конец (LRU)
            self.cache.move_to_end(key)
            self.hits += 1
            logger.debug(f"Cache hit for key: {key}")
            return entry.value

    def set(self, key, value, ttl):
        """Сохранить значение в кэш"""
        with self.lock:
            # Если кэш полон, удаляем самый старый элемент
            if len(self.cache) >= self.max_size and key not in self.cache:
                oldest_key = next(iter(self.cache))
                del self.cache[oldest_key]
                logger.debug(f"Cache evicted oldest key: {oldest_key}")

            self.cache[key] = CacheEntry(value, ttl)
            self.cache.move_to_end(key)
            logger.debug(f"Cache set for key: {key} (TTL: {ttl}s)")

    def clear(self):
        """Очистить весь кэш"""
        with self.lock:
            self.cache.clear()
            self.hits = 0
            self.misses = 0
            logger.info("Cache cleared")

    def get_stats(self):
        """Получить статистику кэша"""
        with self.lock:
            total = self.hits + self.misses
            hit_rate = (self.hits / total * 100) if total > 0 else 0
            return {
                'size': len(self.cache),
                'max_size': self.max_size,
                'hits': self.hits,
                'misses': self.misses,
                'hit_rate': f"{hit_rate:.2f}%"
            }


# Глобальный кэш
_cache = SimpleCache(max_size=config.CACHE_MAX_SIZE) if config.CACHE_ENABLED else None


def cached(ttl=None, key_prefix=''):
    """
    Декоратор для кэширования результатов функций

    Args:
        ttl: время жизни кэша в секундах (по умолчанию из конфига)
        key_prefix: префикс для ключа кэша

    Example:
        @cached(ttl=300, key_prefix='metar')
        def get_metar(icao: str):
            return fetch_from_api(icao)
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Если кэш отключен, просто вызываем функцию
            if not config.CACHE_ENABLED or _cache is None:
                return func(*args, **kwargs)

            # Создаем ключ кэша
            cache_key = f"{key_prefix}:{func.__name__}:{str(args)}:{str(kwargs)}"

            # Проверяем кэш
            cached_value = _cache.get(cache_key)
            if cached_value is not None:
                logger.info(f"Using cached result for {func.__name__}")
                return cached_value

            # Вызываем функцию
            result = func(*args, **kwargs)

            # Сохраняем в кэш
            cache_ttl = ttl if ttl is not None else config.CACHE_TTL_METAR
            _cache.set(cache_key, result, cache_ttl)

            return result

        return wrapper
    return decorator


def get_cache_stats():
    """Получить статистику кэша"""
    if _cache is None:
        return {'enabled': False}
    return {**_cache.get_stats(), 'enabled': True}


def clear_cache():
    """Очистить кэш"""
    if _cache is not None:
        _cache.clear()
