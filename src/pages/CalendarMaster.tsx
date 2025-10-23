// app/calendar/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Navigation } from "@/components/navigation";

type CalRow = {
  date: string;        // DATE column as 'YYYY-MM-DD'
  day?: string | null; // optional
  working_time: number;
  over_time: number;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function monthRange(y: number, m1to12: number) {
  const from = `${y}-${pad2(m1to12)}-01`;
  const lastDay = new Date(y, m1to12, 0).getDate();
  const to = `${y}-${pad2(m1to12)}-${pad2(lastDay)}`;
  return { from, to };
}

/** Try seeding a table for a month if RPC exists. Silently continue if RPC missing. */
async function trySeed(tableNo: 1 | 2, y: number, m1to12: number) {
  const fn = tableNo === 1 ? "calender1_seed_month" : "calender2_seed_month";
  const { error } = await supabase.rpc(fn as "calender1_seed_month" | "calender2_seed_month", { p_year: y, p_month: m1to12 });
  if (error) {
    // If the RPC is missing / not defined, just ignore. Otherwise surface real errors.
    const msg = (error.message || "").toLowerCase();
    if (
      msg.includes("not exist") ||
      msg.includes("does not exist") ||
      msg.includes("no function") ||
      msg.includes("not found")
    ) {
      // Ignore missing seeder, continue to fetch rows.
      return;
    }
    throw new Error(`[${fn}] ${error.message}`);
  }
}

/** Fetch a month's rows from a given calendar table */
async function fetchCalendar(table: "calender1" | "calender2", y: number, m1to12: number) {
  const { from, to } = monthRange(y, m1to12);
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });

  if (error) throw new Error(`[${table}] ${error.message}`);
  return (data ?? []) as CalRow[];
}

/** Inline editable numeric cell */
function EditableNumberCell({
  value,
  onSave,
  min = 0,
  step = 1,
  disabled,
  ariaLabel,
}: {
  value: number;
  onSave: (next: number) => Promise<void> | void;
  min?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => setText(String(value)), [value]);

  const parse = (s: string) => {
    if (s.trim() === "") return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    if (n < min) return min;
    return Math.round(n / step) * step;
  };

  const commit = async () => {
    if (disabled || saving) return;
    const parsed = parse(text);
    if (parsed === null || parsed === value) {
      setText(String(value));
      return;
    }
    try {
      setSaving(true);
      await onSave(parsed);
      toast.success("Saved");
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Failed to save";
      toast.error(errorMessage);
      setText(String(value));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <Input
        aria-label={ariaLabel}
        type="number"
        inputMode="numeric"
        className="w-28 text-right"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            setText(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        min={min}
        step={step}
        disabled={disabled || saving}
      />
      {saving ? <span className="text-xs text-slate-500">Saving…</span> : null}
    </div>
  );
}

export default function CalendarPage() {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1..12

  const [rows1, setRows1] = useState<CalRow[]>([]);
  const [rows2, setRows2] = useState<CalRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      setLoading(true);

      // Seed if RPCs exist (ignore if missing)
      await Promise.all([trySeed(1, year, month), trySeed(2, year, month)]);

      // Fetch both tables
      const [d1, d2] = await Promise.all([
        fetchCalendar("calender1", year, month),
        fetchCalendar("calender2", year, month),
      ]);
      setRows1(d1);
      setRows2(d2);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to fetch records: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  /** Update a single field in a specific table, optimistic */
  const saveField = async (
    table: "calender1" | "calender2",
    date: string,
    patch: Partial<Pick<CalRow, "working_time" | "over_time">>
  ) => {
    if (table === "calender1") {
      setRows1((prev) => prev.map((r) => (r.date === date ? { ...r, ...patch } : r)));
    } else {
      setRows2((prev) => prev.map((r) => (r.date === date ? { ...r, ...patch } : r)));
    }

    const { error } = await supabase.from(table).update(patch).eq("date", date);
    if (error) throw new Error(error.message);
  };

  /** Render a calendar table */
  const CalendarTable = ({
    title,
    tableName,
    rows,
  }: {
    title: string;
    tableName: "calender1" | "calender2";
    rows: CalRow[];
  }) => (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        <span className="text-xs text-slate-500">{rows.length} days</span>
      </div>

      <div className="border dark:border-slate-700 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            No rows for {year}-{pad2(month)}.
          </div>
        ) : (
          <div className="relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="border-b bg-slate-50 dark:bg-slate-900">
                  <th className="h-12 px-4 text-left font-semibold">Date</th>
                  <th className="h-12 px-4 text-left font-semibold">Day</th>
                  <th className="h-12 px-4 text-right font-semibold">Working Time</th>
                  <th className="h-12 px-4 text-right font-semibold">Overtime</th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {rows.map((r) => (
                  <tr
                    key={`${tableName}-${r.date}`}
                    className="border-b transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
                  >
                    <td className="p-4">{r.date}</td>
                    <td className="p-4">{r.day ?? ""}</td>

                    <td className="p-4">
                      <EditableNumberCell
                        value={r.working_time ?? 0}
                        ariaLabel={`Working time for ${r.date} (${tableName})`}
                        onSave={(next) => saveField(tableName, r.date, { working_time: next })}
                        min={0}
                        step={1}
                      />
                    </td>

                    <td className="p-4">
                      <EditableNumberCell
                        value={r.over_time ?? 0}
                        ariaLabel={`Overtime for ${r.date} (${tableName})`}
                        onSave={(next) => saveField(tableName, r.date, { over_time: next })}
                        min={0}
                        step={1}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500 mt-3">
        Tip: Edit a value and press <kbd>Enter</kbd> to save or <kbd>Esc</kbd> to cancel. Saves on blur, too.
      </p>
    </div>
  );

  return (
    // Local shell: persistent left nav for this page only
    <div className="min-h-dvh grid grid-cols-[260px_1fr]">
      <aside className="border-r bg-white dark:bg-slate-900 sticky top-0 h-dvh overflow-y-auto">
        <Navigation />
      </aside>

      <main className="min-w-0 overflow-x-hidden">
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
          <div className="max-w-7xl mx-auto">
            {/* Header & controls */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6 mb-6">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100">
                    Calendar Master
                  </h1>
                  <p className="text-slate-600 dark:text-slate-400 mt-1">
                    Calender1 & Calender2 side-by-side. Weekdays seeded 910, weekends 0, OT 0.
                  </p>
                </div>

                <div className="flex items-end gap-3">
                  <div>
                    <Label htmlFor="year">Year</Label>
                    <Input
                      id="year"
                      type="number"
                      value={year}
                      onChange={(e) => {
                        const v = parseInt(e.target.value || "0", 10);
                        if (Number.isFinite(v)) setYear(v);
                      }}
                      className="w-28"
                    />
                  </div>
                  <div>
                    <Label htmlFor="month">Month (1–12)</Label>
                    <Input
                      id="month"
                      type="number"
                      min={1}
                      max={12}
                      value={month}
                      onChange={(e) => {
                        const v = parseInt(e.target.value || "0", 10);
                        if (v >= 1 && v <= 12) setMonth(v);
                      }}
                      className="w-28"
                    />
                  </div>
                  <Button onClick={load} disabled={loading}>
                    {loading ? "Loading…" : "Reload"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Two-column layout for the two calendars */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <CalendarTable title="Calender 1" tableName="calender1" rows={rows1} />
              <CalendarTable title="Calender 2" tableName="calender2" rows={rows2} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}