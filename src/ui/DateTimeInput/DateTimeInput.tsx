import { useState } from "preact/hooks";
import {
    DatePicker,
    type DatePickerValueChangeDetails,
} from "@ark-ui/react/date-picker";
import { Portal } from "@ark-ui/react/portal";
import { CalendarDateTime } from "@internationalized/date";
import {
    CalendarIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
} from "lucide-react";
import styles from "./DateTimeInput.module.css";

export interface DateTimeInputProps {
    value?: number; // Unix timestamp in milliseconds
    onChange: (timestampMs: number) => void;
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}

const toCalendarDateTime = (ts: number): CalendarDateTime => {
    const d = new Date(ts);
    return new CalendarDateTime(
        d.getFullYear(),
        d.getMonth() + 1,
        d.getDate(),
        d.getHours(),
        d.getMinutes(),
    );
};

const toTimestamp = (cdt: CalendarDateTime): number => {
    const d = new Date(
        cdt.year,
        cdt.month - 1,
        cdt.day,
        cdt.hour ?? 0,
        cdt.minute ?? 0,
        0,
    );
    return d.getTime();
};

export function DateTimeInput({
    value = Date.now(),
    onChange,
    label,
    placeholder = "YYYY-MM-DD",
    disabled,
    className,
}: DateTimeInputProps) {
    const [calendarVal, setCalendarVal] = useState<CalendarDateTime[]>([
        toCalendarDateTime(value),
    ]);

    const currentVal = calendarVal[0] || toCalendarDateTime(value);

    const timeString = `${String(currentVal.hour ?? 0).padStart(2, "0")}:${String(
        currentVal.minute ?? 0,
    ).padStart(2, "0")}`;

    const handleDateChange = (details: DatePickerValueChangeDetails) => {
        const newDate = details.value[0];
        if (!newDate) return;

        const updated = new CalendarDateTime(
            newDate.year,
            newDate.month,
            newDate.day,
            currentVal.hour ?? 0,
            currentVal.minute ?? 0,
        );

        setCalendarVal([updated]);
        onChange(toTimestamp(updated));
    };

    const handleTimeChange = (e: any) => {
        const val = e.target.value;
        if (!val) return;
        const [hours, minutes] = val.split(":").map(Number);

        const updated = currentVal.set({
            hour: hours || 0,
            minute: minutes || 0,
        });

        setCalendarVal([updated]);
        onChange(toTimestamp(updated));
    };

    const handleNowClick = () => {
        const nowMs = Date.now();
        const updated = toCalendarDateTime(nowMs);
        setCalendarVal([updated]);
        onChange(nowMs);
    };

    return (
        <div className={[styles.root, className].filter(Boolean).join(" ")}>
            {label && <label className={styles.label}>{label}</label>}

            <DatePicker.Root
                value={calendarVal}
                onValueChange={handleDateChange}
                closeOnSelect={false}
                disabled={disabled}
            >
                <DatePicker.Control className={styles.control}>
                    {/* Ark UI Date Input component for direct text/segment typing */}
                    <DatePicker.Input
                        className={styles.dateInput}
                        placeholder={placeholder}
                    />

                    {/* Inline Time Input */}
                    <input
                        type="time"
                        value={timeString}
                        onChange={handleTimeChange}
                        className={styles.timeInputInline}
                    />

                    {/* Calendar Dropdown Trigger Button */}
                    <DatePicker.Trigger className={styles.triggerBtn}>
                        <CalendarIcon />
                    </DatePicker.Trigger>
                </DatePicker.Control>

                <Portal>
                    <DatePicker.Positioner className={styles.positioner}>
                        <DatePicker.Content className={styles.content}>
                            <DatePicker.View view="day" className={styles.view}>
                                <DatePicker.Context>
                                    {(datePicker) => (
                                        <>
                                            <DatePicker.ViewControl className={styles.viewControl}>
                                                <DatePicker.PrevTrigger className={styles.navBtn}>
                                                    <ChevronLeftIcon />
                                                </DatePicker.PrevTrigger>
                                                <DatePicker.ViewTrigger className={styles.viewTrigger}>
                                                    <DatePicker.RangeText />
                                                </DatePicker.ViewTrigger>
                                                <DatePicker.NextTrigger className={styles.navBtn}>
                                                    <ChevronRightIcon />
                                                </DatePicker.NextTrigger>
                                            </DatePicker.ViewControl>

                                            <DatePicker.Table className={styles.table}>
                                                <DatePicker.TableHead>
                                                    <DatePicker.TableRow>
                                                        {datePicker.weekDays.map((weekDay, id) => (
                                                            <DatePicker.TableHeader
                                                                className={styles.tableHeader}
                                                                key={id}
                                                            >
                                                                {weekDay.short}
                                                            </DatePicker.TableHeader>
                                                        ))}
                                                    </DatePicker.TableRow>
                                                </DatePicker.TableHead>
                                                <DatePicker.TableBody>
                                                    {datePicker.weeks.map((week, id) => (
                                                        <DatePicker.TableRow key={id}>
                                                            {week.map((day, dayId) => (
                                                                <DatePicker.TableCell
                                                                    className={styles.tableCell}
                                                                    key={dayId}
                                                                    value={day}
                                                                >
                                                                    <DatePicker.TableCellTrigger
                                                                        className={styles.cellTrigger}
                                                                    >
                                                                        {day.day}
                                                                    </DatePicker.TableCellTrigger>
                                                                </DatePicker.TableCell>
                                                            ))}
                                                        </DatePicker.TableRow>
                                                    ))}
                                                </DatePicker.TableBody>
                                            </DatePicker.Table>

                                            <div className={styles.actionRow}>
                                                <button
                                                    type="button"
                                                    className={styles.nowBtn}
                                                    onClick={handleNowClick}
                                                >
                                                    ⚡ Set to Now
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </DatePicker.Context>
                            </DatePicker.View>
                        </DatePicker.Content>
                    </DatePicker.Positioner>
                </Portal>
            </DatePicker.Root>
        </div>
    );
}
