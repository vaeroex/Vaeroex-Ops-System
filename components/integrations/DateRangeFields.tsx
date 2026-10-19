"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { recentDateRange } from "@/lib/integrations/date-range";

const inputClass = "mt-1 block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink";
const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-md border border-line px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue";

export function DateRangeFields({ idPrefix, defaultStartDate, defaultEndDate, maxDate }: {
  idPrefix: string; defaultStartDate: string; defaultEndDate: string; maxDate: string;
}) {
  const [start, setStart] = useState(defaultStartDate);
  const [end, setEnd] = useState(defaultEndDate);
  const [preset, setPreset] = useState<string>(() => String([30, 90, 365].find(days => {
    const range = recentDateRange(days, maxDate);
    return range.startDate === start && range.endDate === end;
  }) ?? "custom"));
  return <fieldset className="space-y-3">
    <legend className="text-sm font-semibold">Import dates (UTC)</legend>
    <label htmlFor={`${idPrefix}-preset`} className="block text-sm">Choose a period
      <select id={`${idPrefix}-preset`} value={preset} className={inputClass} onChange={event => {
        setPreset(event.target.value);
        if (event.target.value === "custom") return;
        const range = recentDateRange(Number(event.target.value), maxDate);
        setStart(range.startDate); setEnd(range.endDate);
      }}>
        <option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 365 days</option><option value="custom">Custom dates</option>
      </select>
    </label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label htmlFor={`${idPrefix}-start`} className="block text-sm">From
        <input id={`${idPrefix}-start`} name="startDate" type="date" required value={start} max={end || maxDate} onChange={event => { setStart(event.target.value); setPreset("custom"); }} className={inputClass} />
      </label>
      <label htmlFor={`${idPrefix}-end`} className="block text-sm">Through
        <input id={`${idPrefix}-end`} name="endDate" type="date" required value={end} min={start} max={maxDate} onChange={event => { setEnd(event.target.value); setPreset("custom"); }} className={inputClass} />
      </label>
    </div>
    <p className="text-sm text-muted">Choose up to 366 calendar days per import, including older years. For busy accounts, use smaller consecutive periods. Today includes data available when the import runs.</p>
  </fieldset>;
}

export function SavedHistoryFilter({ action, startDate, endDate, maxDate }: {
  action: string; startDate: string | null; endDate: string | null; maxDate: string;
}) {
  return <form action={action} method="get" className="space-y-3 rounded-md border border-line p-4">
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Filter saved history (UTC)</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">From<input name="from" type="date" required defaultValue={startDate ?? ""} max={maxDate} className={inputClass} /></label>
        <label className="block text-sm">Through<input name="to" type="date" required defaultValue={endDate ?? ""} max={maxDate} className={inputClass} /></label>
      </div>
    </fieldset>
    <div className="flex flex-wrap items-center gap-3"><button type="submit" className={buttonClass}>View saved dates</button><Link href={action as Route} className={`${buttonClass} text-vaeroex-blue`}>All saved history</Link></div>
    <p className="text-sm text-muted">Filters use data already imported into this workspace. They do not import missing dates or use provider API requests.</p>
  </form>;
}
