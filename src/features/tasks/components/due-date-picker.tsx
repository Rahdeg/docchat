"use client";

import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { dayToLocalDate, localDay, type CalendarDay } from "../task-rules";

type DueDatePickerProps = {
  value: CalendarDay | null;
  // null clears the date.
  onChange: (day: CalendarDay | null) => void;
  // The button that opens the calendar.
  trigger: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
};

// A calendar in a popover, for a task's due date. Days only, no time.
export function DueDatePicker({
  value,
  onChange,
  trigger,
  open,
  onOpenChange,
  align = "end",
}: DueDatePickerProps) {
  const selected = value ? dayToLocalDate(value) : undefined;

  function pick(day: CalendarDay | null) {
    onChange(day);
    onOpenChange?.(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align={align} className="w-auto p-0 paper">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => pick(date ? localDay(date) : null)}
          weekStartsOn={1}
        />
        {value ? (
          <div className="border-t p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => pick(null)}>
              Clear date
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
