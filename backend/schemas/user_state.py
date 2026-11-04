"""Bounded non-portfolio state contracts."""
import json
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import BaseModel, Field, AfterValidator, model_validator, field_validator


def opaque_id(value: str) -> str:
    if str(UUID(value)) != value or UUID(value).version != 4:
        raise ValueError("Expected canonical UUIDv4")
    return value


ResourceId = Annotated[str, AfterValidator(opaque_id)]
ShortString = Annotated[str, Field(min_length=1, max_length=100)]


def bounded_json(value):
    def visit(node, depth=0):
        if depth > 10:
            raise ValueError("JSON nesting exceeds 10 levels")
        if isinstance(node, dict):
            for key, child in node.items():
                if not isinstance(key, str) or len(key) > 100:
                    raise ValueError("Invalid JSON key")
                visit(child, depth + 1)
        elif isinstance(node, list):
            for child in node:
                visit(child, depth + 1)
    visit(value)
    if len(json.dumps(value, allow_nan=False).encode()) > 65536:
        raise ValueError("JSON exceeds 64 KiB")
    return value


class WidgetSchema(BaseModel):
    id: ResourceId
    screenId: ResourceId
    type: Literal["basic-chart", "advanced-chart", "economic-calendar", "watchlist", "symbol-overview"]
    x: int = Field(ge=0, le=23)
    y: int = Field(ge=0, le=10000)
    w: int = Field(ge=1, le=24)
    h: int = Field(ge=1, le=1000)
    minW: int = Field(default=1, ge=1, le=24)
    minH: int = Field(default=1, ge=1, le=1000)
    createdAt: int = Field(ge=0, le=2**63-1)

    @model_validator(mode="after")
    def dimensions(self):
        if self.x + self.w > 24 or self.w < self.minW or self.h < self.minH:
            raise ValueError("Invalid widget dimensions")
        return self


class ScreenSchema(BaseModel):
    id: ResourceId
    name: str = Field(min_length=1, max_length=255)
    order: int = Field(default=0, ge=0, le=1000)
    createdAt: int = Field(ge=0, le=2**63-1)


class LayoutPayload(BaseModel):
    screens: list[ScreenSchema] = Field(min_length=1, max_length=50)
    activeScreenId: ResourceId
    widgets: list[WidgetSchema] = Field(max_length=200)
    revision: int = Field(default=0, ge=0, le=2**31-2)

    @model_validator(mode="after")
    def relationships(self):
        screens = {s.id for s in self.screens}
        if len(screens) != len(self.screens) or self.activeScreenId not in screens:
            raise ValueError("Duplicate or missing screen")
        if len({w.id for w in self.widgets}) != len(self.widgets):
            raise ValueError("Duplicate widget")
        if any(w.screenId not in screens for w in self.widgets):
            raise ValueError("Widget references missing screen")
        return self


class WidgetStatePayload(BaseModel):
    symbol: str | None = Field(default=None, max_length=50)
    interval: str | None = Field(default=None, max_length=20)
    state: dict | None = None
    _bounds = field_validator("state")(bounded_json)


class WatchlistSavePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    order: int = Field(default=0, ge=0, le=1000)
    items: list[Annotated[str, Field(min_length=1, max_length=50)]] = Field(default_factory=list, max_length=500)
    rowState: dict | None = None
    _bounds = field_validator("rowState")(bounded_json)


class WatchlistSchema(WatchlistSavePayload):
    id: ResourceId
    createdAt: int
    updatedAt: int


class SettingsPayload(BaseModel):
    settings: dict[str, object]

    @field_validator("settings")
    @classmethod
    def validate_settings(cls, values):
        bounded_json(values)
        strings = {"general.language", "general.storage", "integrations.tickrbaseBridge.url",
                   "inregrations.tradingView.embedUrl", "basicChart.defaultInterval", "defaultChartSymbol",
                   "advancedChart.defaultSymbol", "economicCalendar.defaultCountryFilter"}
        booleans = {"watchlist.disablePulse", "economicCalendar.defaultImportanceFilter"}
        for key, value in values.items():
            # Portfolio settings retain their existing shared contract until redesign.
            if key.startswith("portfolio."):
                continue
            if key in strings and isinstance(value, str) and len(value) <= 2048:
                continue
            if key in booleans and type(value) is bool:
                continue
            if key == "crosshairMode" and type(value) is int and value in (0, 1, 2):
                continue
            if key == "general.timezone" and isinstance(value, str):
                try:
                    ZoneInfo(value)
                    continue
                except (ZoneInfoNotFoundError, ValueError):
                    pass
            raise ValueError("Unknown setting or invalid value")
        return values


class TablePrefPayload(BaseModel):
    scopeType: Literal["widget", "page"]
    scopeId: ShortString
    tableId: ShortString
    prefs: dict[str, object]
    _bounds = field_validator("prefs")(bounded_json)
