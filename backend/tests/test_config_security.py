import os
from pathlib import Path
import runpy

import pytest


CONFIG_SOURCE = Path(__file__).resolve().parents[1] / "core" / "config.py"
TEST_SECRET = "a-test-only-secret-with-at-least-32-characters"


@pytest.fixture
def load_config(tmp_path, monkeypatch):
    # Exercise real dotenv loading without reading a developer's credentials.
    core = tmp_path / "core"
    core.mkdir()
    config_path = core / "config.py"
    config_path.write_text(CONFIG_SOURCE.read_text(encoding="utf-8"), encoding="utf-8")
    for name in list(os.environ):
        if name.startswith(("JWT_", "COOKIE_", "ACCESS_TOKEN_", "LOGO_DEV_")) or name in {
            "ENV", "DATABASE_URL", "REDIS_URL", "CORS_ORIGINS",
        }:
            monkeypatch.delenv(name)

    def load(settings=None, dev_file=""):
        (tmp_path / ".env.dev").write_text(dev_file, encoding="utf-8")
        for key, value in (settings or {}).items():
            monkeypatch.setenv(key, value)
        return runpy.run_path(str(config_path))

    return load


def production_settings(**overrides):
    return {
        "ENV": "production", "JWT_SECRET": TEST_SECRET,
        "DATABASE_URL": "postgresql+asyncpg://app:password@db/app",
        "REDIS_URL": "redis://cache:6379/0",
        "CORS_ORIGINS": "https://app.example.com", **overrides,
    }


def test_production_does_not_load_dev_credentials(load_config):
    config = load_config(production_settings(), "LOGO_DEV_TOKEN=private-local-token\n")
    assert config["LOGO_DEV_TOKEN"] == ""
    assert config["COOKIE_SECURE"] is True


def test_local_file_loads_without_overriding_process_settings(load_config):
    config = load_config(
        {"ENV": "dev", "JWT_SECRET": TEST_SECRET},
        "JWT_SECRET=file-value\nLOGO_DEV_TOKEN=local-token\n",
    )
    assert config["JWT_SECRET"] == TEST_SECRET
    assert config["LOGO_DEV_TOKEN"] == "local-token"


@pytest.mark.parametrize("secret", ["", "short", " " * 40, "dev_secret_key_change_in_production_987654321_tickrbase"])
def test_missing_or_unsafe_secret_rejected(load_config, secret):
    with pytest.raises(ValueError, match="JWT_SECRET"):
        load_config(production_settings(JWT_SECRET=secret))


def test_local_mode_also_requires_explicit_strong_secret(load_config):
    with pytest.raises(ValueError, match="JWT_SECRET"):
        load_config({"ENV": "dev"})


@pytest.mark.parametrize("overrides", [
    {"COOKIE_SECURE": "false"}, {"COOKIE_SECURE": "typo"},
    {"COOKIE_SAMESITE": "typo"}, {"JWT_ALGORITHM": "none"},
    {"ACCESS_TOKEN_EXPIRE_MINUTES": "0"}, {"LOGO_DEV_MONTHLY_LIMIT": "-1"},
    {"CORS_ORIGINS": "*"}, {"CORS_ORIGINS": "http://app.example.com"},
    {"CORS_ORIGINS": "https://app.example.com/path"},
    {"CORS_ORIGINS": ", ,"}, {"CORS_ORIGINS": "https://app.example.com:invalid"},
])
def test_unsafe_production_settings_rejected(load_config, overrides):
    with pytest.raises(ValueError):
        load_config(production_settings(**overrides))


@pytest.mark.parametrize("missing", ["DATABASE_URL", "REDIS_URL", "CORS_ORIGINS"])
def test_nonlocal_services_require_explicit_settings(load_config, missing):
    settings = production_settings()
    settings.pop(missing)
    with pytest.raises(ValueError, match=missing):
        load_config(settings)


def test_unknown_environment_fails_closed(load_config):
    with pytest.raises(ValueError, match="ENV"):
        load_config(production_settings(ENV="prodution"))


def test_cross_site_cookie_requires_secure_transport(load_config):
    with pytest.raises(ValueError, match="COOKIE"):
        load_config({"ENV": "dev", "JWT_SECRET": TEST_SECRET, "COOKIE_SAMESITE": "none"})
