// app/actual/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigation } from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { CalendarDays, ChevronsUpDown, Check, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Recharts
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  ComposedChart, Area,
  XAxis, YAxis, Tooltip, Legend,
} from "recharts";

/* =========================
   Types
========================= */
interface MasterRow {
  no_mat: string;
  price: number;          // master.Price
  quantity: number;       // master.qty
  category: string | null;
  mat_name?: string | null;
  uom?: string | null;
}
interface ActualRow {
  no_mat: string;
  posting_date: string;
  document_date?: string | null;
  quantity: number;
  dept: string | null;
}
interface ForecastRow {
  no_mat: string;
  shop: string | null;
  quantity: number;
  month?: string | null;
}

type DeptMode = "all" | "list" | "unassigned";
type MaterialOpt = "all" | "Direct Material" | "Indirect Material" | "Unassigned";
interface FilterState {
  month: number;
  year: number;
  deptMode: DeptMode;
  deptSelected?: string;
  material: MaterialOpt;
}
type GraphMode = "Combination" | "Daily Control" | "Accumulative Control";

/* =========================
   Constants
========================= */
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 7 }, (_, i) => THIS_YEAR - 3 + i);
const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" }, { value: 3, label: "March" },
  { value: 4, label: "April" },   { value: 5, label: "May" },      { value: 6, label: "June" },
  { value: 7, label: "July" },    { value: 8, label: "August" },   { value: 9, label: "September" },
  { value: 10, label: "October" },{ value: 11, label: "November" },{ value: 12, label: "December" },
];

/* =========================
   Date helpers
========================= */
const fmtDate = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD
function monthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0)); // last day
  return { start, end };
}
function listMonthDates(year: number, month: number): string[] {
  const { start, end } = monthRange(year, month);
  const days: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(fmtDate(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}
function normalizeDateString(x: any): string | null {
  if (!x) return null;
  const s = String(x);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/(\d{4,5})-(\d{2})-(\d{2})/);
  if (m) { const yyyy = m[1].slice(-4); return `${yyyy}-${m[2]}-${m[3]}`; }
  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/* =========================
   Utils
========================= */
function safeNumber(n: any, d = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : d;
}
function normalizeCategory(raw: string | null | undefined): "Direct Material" | "Indirect Material" | "Unassigned" {
  const s = (raw ?? "").trim().toLowerCase();
  if (["direct", "direct material", "dm"].includes(s)) return "Direct Material";
  if (["indirect", "indirect material", "im"].includes(s)) return "Indirect Material";
  return "Unassigned";
}
const fmtIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

/* =========================
   Filters UI
========================= */
function FiltersUI({
  filters,
  setFilters,
  deptOptions,
}: {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  deptOptions: string[];
}) {
  const now = new Date();

  return (
    <div className="grid gap-4 md:grid-cols-12">
      {/* Month selector */}
      <div className="md:col-span-4 space-y-2">
        <Label>Month</Label>
        <div className="flex gap-2">
          <Select value={String(filters.month)} onValueChange={(v) => setFilters(f => ({ ...f, month: Number(v) }))}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Month" /></SelectTrigger>
            <SelectContent>
              {MONTHS.map(m => (<SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={String(filters.year)} onValueChange={(v) => setFilters(f => ({ ...f, year: Number(v) }))}>
            <SelectTrigger className="w-28"><SelectValue placeholder="Year" /></SelectTrigger>
            <SelectContent>
              {YEARS.map(y => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="gap-2 h-9"
            onClick={() => setFilters(f => ({ ...f, month: now.getMonth() + 1, year: now.getFullYear() }))}
          >
            <CalendarDays className="h-4 w-4" /> This month
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Applies to both <span className="font-mono">forecast</span> and <span className="font-mono">actual</span>.
        </p>
      </div>

      {/* Department mode */}
      <div className="md:col-span-4 space-y-2">
        <Label>Department</Label>
        <div className="flex gap-2">
          <Select value={filters.deptMode} onValueChange={(v: DeptMode) => setFilters(f => ({ ...f, deptMode: v }))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="list">List</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
            </SelectContent>
          </Select>
          {filters.deptMode === "list" && (
            <DeptCombobox
              value={filters.deptSelected}
              options={deptOptions}
              onSelect={(v) => setFilters(f => ({ ...f, deptSelected: v }))}
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Source list from <span className="font-mono">shop.dept</span>; “Unassigned” = values in
          <span className="font-mono"> actual.dept</span>/<span className="font-mono">forecast.shop</span> not in
          <span className="font-mono"> shop.dept</span>.
        </p>
      </div>

      {/* Material */}
      <div className="md:col-span-4 space-y-2">
        <Label>Material</Label>
        <Select value={filters.material} onValueChange={(v: MaterialOpt) => setFilters(f => ({ ...f, material: v }))}>
          <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="Direct Material">Direct Material</SelectItem>
            <SelectItem value="Indirect Material">Indirect Material</SelectItem>
            <SelectItem value="Unassigned">Unassigned</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Based on <span className="font-mono">master.category</span>.</p>
      </div>
    </div>
  );
}

function DeptCombobox({
  value,
  options,
  onSelect,
}: {
  value?: string;
  options: string[];
  onSelect: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className={cn("w-56 justify-between", !value && "text-muted-foreground")}>
          {value || "Select department"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0">
        <Command>
          <CommandInput placeholder="Search dept..." />
          <CommandEmpty>No department found.</CommandEmpty>
          <CommandGroup>
            {options.map((dept) => (
              <CommandItem key={dept} value={dept} onSelect={(v) => { onSelect(v); setOpen(false); }}>
                <Check className={cn("mr-2 h-4 w-4", dept === value ? "opacity-100" : "opacity-0")} />
                {dept}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* =========================
   Graph Block
========================= */
function GraphBlock({ mode, data }: { mode: GraphMode; data: any[] }) {
  const BLUE  = "hsl(var(--chart-1))"; // Actual / Cum Actual
  const GREEN = "hsl(var(--chart-2))"; // Forecast & bands
  const yTick = (v: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);

  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const map: Record<string, number> = {};
    payload.forEach((p: any) => { map[p.name] = p.value; });
    return (
      <div className="rounded-md border bg-popover p-3 text-popover-foreground shadow-sm">
        <div className="text-xs font-medium">Day {label}</div>
        {"Actual" in map && <div className="text-xs">Actual: <span className="font-mono">{fmtIDR(map["Actual"])}</span></div>}
        {"Forecast" in map && <div className="text-xs">Forecast: <span className="font-mono">{fmtIDR(map["Forecast"])}</span></div>}
        {"Cum Actual" in map && <div className="text-xs">Cum A: <span className="font-mono">{fmtIDR(map["Cum Actual"])}</span></div>}
        {"Cum Forecast (mid)" in map && <div className="text-xs">Cum F: <span className="font-mono">{fmtIDR(map["Cum Forecast (mid)"])}</span></div>}
        {"Cum Forecast (lower)" in map && <div className="text-xs">Lower: <span className="font-mono">{fmtIDR(map["Cum Forecast (lower)"])}</span></div>}
        {"Cum Forecast (upper)" in map && <div className="text-xs">Upper: <span className="font-mono">{fmtIDR(map["Cum Forecast (upper)"])}</span></div>}
      </div>
    );
  };

  if (mode === "Daily Control") {
    return (
      <div className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="date" axisLine={false} tickLine={false} />
            <YAxis tickFormatter={yTick} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Bar dataKey="actual"   name="Actual"   fill={BLUE}  stroke={BLUE}  radius={[6,6,0,0]} />
            <Bar dataKey="forecast" name="Forecast" fill={GREEN} stroke={GREEN} radius={[6,6,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (mode === "Accumulative Control") {
    return <CumulativeChart data={data} />;
  }

  return (
    <div className="h-[460px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <XAxis dataKey="date" axisLine={false} tickLine={false} />
          <YAxis tickFormatter={yTick} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <Legend />

          {/* baseline so bands start at lower */}
          <Area dataKey="cumForecastLower" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />

          {/* Band: lower -> mid */}
          <Area dataKey="bandBottom" stackId="band" name="Band (lower→mid)" stroke="none" fill={GREEN} fillOpacity={0.15} isAnimationActive={false} />
          {/* Band: mid -> upper */}
          <Area dataKey="bandTop"    stackId="band" name="Band (mid→upper)"  stroke="none" fill={GREEN} fillOpacity={0.10} isAnimationActive={false} />

          {/* Bars */}
          <Bar dataKey="actual"   name="Actual"   fill={BLUE}  stroke={BLUE}  radius={[6,6,0,0]} />
          <Bar dataKey="forecast" name="Forecast" fill={GREEN} stroke={GREEN} radius={[6,6,0,0]} />

          {/* Lines */}
          <Line type="monotone" dataKey="cumActual"        name="Cum Actual"           dot={false} strokeWidth={2}   stroke={BLUE} />
          <Line type="monotone" dataKey="cumForecast"      name="Cum Forecast (mid)"   dot={false} strokeWidth={2.5} stroke={GREEN} />
          <Line type="monotone" dataKey="cumForecastLower" name="Cum Forecast (lower)" dot={false} strokeWidth={1.5} stroke={GREEN} strokeDasharray="5 5" />
          <Line type="monotone" dataKey="cumForecastUpper" name="Cum Forecast (upper)" dot={false} strokeWidth={1.5} stroke={GREEN} strokeDasharray="5 5" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* =========================
   Cumulative Chart with upper/mid/lower + bands
========================= */
function CumulativeChart({ data }: { data: any[] }) {
  const BLUE  = "hsl(var(--chart-1))";
  const GREEN = "hsl(var(--chart-2))";

  const yTick = (v: number) =>
    new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);

  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const map: Record<string, number> = {};
    payload.forEach((p: any) => (map[p.name] = p.value));
    const idr = (x:number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(x);
    return (
      <div className="rounded-md border bg-popover p-3 text-popover-foreground shadow-sm">
        <div className="text-xs font-medium">Day {label}</div>
        {"Cum Actual" in map && <div className="text-xs">Cum A: <span className="font-mono">{idr(map["Cum Actual"])}</span></div>}
        {"Cum Forecast (mid)" in map && <div className="text-xs">Cum F: <span className="font-mono">{idr(map["Cum Forecast (mid)"])}</span></div>}
        {"Cum Forecast (lower)" in map && <div className="text-xs">Lower: <span className="font-mono">{idr(map["Cum Forecast (lower)"])}</span></div>}
        {"Cum Forecast (upper)" in map && <div className="text-xs">Upper: <span className="font-mono">{idr(map["Cum Forecast (upper)"])}</span></div>}
      </div>
    );
  };

  return (
    <div className="h-[420px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <XAxis dataKey="date" axisLine={false} tickLine={false} />
          <YAxis tickFormatter={yTick} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <Legend />

          {/* Invisible baseline at lower so stacked areas start from lower */}
          <Area dataKey="cumForecastLower" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />

          {/* Band: lower -> mid */}
          <Area dataKey="bandBottom" stackId="band" name="Band (lower→mid)" stroke="none" fill={GREEN} fillOpacity={0.15} isAnimationActive={false} />
          {/* Band: mid -> upper */}
          <Area dataKey="bandTop" stackId="band" name="Band (mid→upper)" stroke="none" fill={GREEN} fillOpacity={0.10} isAnimationActive={false} />

          {/* Lines */}
          <Line type="monotone" dataKey="cumForecastLower" name="Cum Forecast (lower)" dot={false} strokeWidth={1.5} stroke={GREEN} strokeDasharray="5 5" isAnimationActive={false} />
          <Line type="monotone" dataKey="cumForecast"      name="Cum Forecast (mid)"   dot={false} strokeWidth={2.5} stroke={GREEN} isAnimationActive={false} />
          <Line type="monotone" dataKey="cumForecastUpper" name="Cum Forecast (upper)" dot={false} strokeWidth={1.5} stroke={GREEN} strokeDasharray="5 5" isAnimationActive={false} />
          <Line type="monotone" dataKey="cumActual"        name="Cum Actual"           dot={false} strokeWidth={2}   stroke={BLUE}  isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* =========================
   UI: 3 anomalies tables
========================= */
function AnomalyTables(props: {
  over: { dept: string; no_mat: string; mat_name: string; diff: number }[];
  under: { dept: string; no_mat: string; mat_name: string; diff: number }[];
  delays: { no_mat: string; mat_name: string; shop: string; quantity: number; delayedDays: number }[];
}) {
  const fmt = fmtIDR;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Over usage */}
      <div className="rounded-xl border">
        <div className="px-4 py-3 border-b text-sm font-medium">Over Usage (A &gt; F)</div>
        <div className="max-h-[340px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="[&>th]:text-left [&>th]:px-3 [&>th]:py-2">
                <th>Dept</th><th>No Mat</th><th>Mat Name</th><th className="text-right">Δ IDR</th>
              </tr>
            </thead>
            <tbody>
              {props.over.map((r, i)=>(
                <tr key={r.dept + r.no_mat + i} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{r.dept}</td>
                  <td className="px-3 py-2 font-mono">{r.no_mat}</td>
                  <td className="px-3 py-2">{r.mat_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.diff)}</td>
                </tr>
              ))}
              {props.over.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No over-usage</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Under usage */}
      <div className="rounded-xl border">
        <div className="px-4 py-3 border-b text-sm font-medium">Under Usage (A &lt; F)</div>
        <div className="max-h-[340px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="[&>th]:text-left [&>th]:px-3 [&>th]:py-2">
                <th>Dept</th><th>No Mat</th><th>Mat Name</th><th className="text-right">Δ IDR</th>
              </tr>
            </thead>
            <tbody>
              {props.under.map((r, i)=>(
                <tr key={r.dept + r.no_mat + i} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{r.dept}</td>
                  <td className="px-3 py-2 font-mono">{r.no_mat}</td>
                  <td className="px-3 py-2">{r.mat_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.diff)}</td>
                </tr>
              ))}
              {props.under.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No under-usage</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delay transactions */}
      <div className="rounded-xl border">
        <div className="px-4 py-3 border-b text-sm font-medium">Delay Transactions (posting &lt; document)</div>
        <div className="max-h-[340px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="[&>th]:text-left [&>th]:px-3 [&>th]:py-2">
                <th>No Mat</th><th>Mat Name</th><th>Shop</th><th className="text-right">Qty</th><th className="text-right">Days</th>
              </tr>
            </thead>
            <tbody>
              {props.delays.map((r, i)=>(
                <tr key={r.no_mat + r.shop + i} className="border-t">
                  <td className="px-3 py-2 font-mono">{r.no_mat}</td>
                  <td className="px-3 py-2">{r.mat_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.shop}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.delayedDays}</td>
                </tr>
              ))}
              {props.delays.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No delayed postings</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* =========================
   UI: Dept summary (toggle)
========================= */
function DeptSummaryBlock(props: {
  show: boolean; setShow: (b:boolean)=>void;
  rows: { dept: string; forecast: number; actual: number; usagePct: number | null }[];
}) {
  return (
    <div className="rounded-xl border">
      <div className="px-4 py-3 flex items-center justify-between border-b">
        <div className="text-sm font-medium">Department Summary (Forecast vs Actual)</div>
        <Button size="sm" variant="outline" onClick={()=>props.setShow(!props.show)}>
          {props.show ? "Hide" : "Show"}
        </Button>
      </div>
      {props.show && (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="[&>th]:text-left [&>th]:px-3 [&>th]:py-2">
                <th>Dept</th>
                <th className="text-right">Forecast (IDR)</th>
                <th className="text-right">Actual (IDR)</th>
                <th className="text-right">Usage %</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((r)=>(
                <tr key={r.dept} className="border-t">
                  <td className="px-3 py-2">{r.dept}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtIDR(r.forecast)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtIDR(r.actual)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.usagePct === null ? "—" : `${r.usagePct.toFixed(2)}%`}
                  </td>
                </tr>
              ))}
              {props.rows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* =========================
   UI: Continuous Over/Under (toggle)
========================= */
function ContinuousUsageBlock(props: {
  show: boolean; setShow: (b:boolean)=>void;
  over: { dept: string; no_mat: string; mat_name: string; diff1: number; diff2: number; diff3: number; pct3m: number | null }[];
  under:{ dept: string; no_mat: string; mat_name: string; diff1: number; diff2: number; diff3: number; pct3m: number | null }[];
}) {
  return (
    <div className="rounded-xl border">
      <div className="px-4 py-3 flex items-center justify-between border-b">
        <div className="text-sm font-medium">Continuous Over / Continuous Under (last 3 months)</div>
        <Button size="sm" variant="outline" onClick={()=>props.setShow(!props.show)}>
          {props.show ? "Hide" : "Show"}
        </Button>
      </div>

      {props.show && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 pt-3">
          {/* Over */}
          <div className="rounded-lg border">
            <div className="px-3 py-2 border-b text-sm font-medium">Continuous Over</div>
            <div className="max-h-[320px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="[&>th]:text-left [&>th]:px-3 [&>th]:py-2">
                    <th>Dept</th><th>No Mat</th><th>Mat Name</th>
                    <th className="text-right">Δ (-2M)</th>
                    <th className="text-right">Δ (-1M)</th>
                    <th className="text-right">Δ (This M)</th>
                    <th className="text-right">Usage % (3M)</th>
                  </tr>
                </thead>
                <tbody>
                  {props.over.map((r, i)=>(
                    <tr key={r.dept + r.no_mat + i} className="border-t">
                      <td className="px-3 py-2">{r.dept}</td>
                      <td className="px-3 py-2 font-mono">{r.no_mat}</td>
                      <td className="px-3 py-2">{r.mat_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtIDR(r.diff1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtIDR(r.diff2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtIDR(r.diff3)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.pct3m === null ? "—" : `${r.pct3m.toFixed(2)}%`}</td>
                    </tr>
                  ))}
                  {props.over.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No continuous over-usage</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Under */}
          <div className="rounded-lg border">
            <div className="px-3 py-2 border-b text-sm font-medium">Continuous Under</div>
            <div className="max-h-[320px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="[&>th]:text-left [&>th]:px-3 [&>th]:py-2">
                    <th>Dept</th><th>No Mat</th><th>Mat Name</th>
                    <th className="text-right">Δ (-2M)</th>
                    <th className="text-right">Δ (-1M)</th>
                    <th className="text-right">Δ (This M)</th>
                    <th className="text-right">Usage % (3M)</th>
                  </tr>
                </thead>
                <tbody>
                  {props.under.map((r, i)=>(
                    <tr key={r.dept + r.no_mat + i} className="border-t">
                      <td className="px-3 py-2">{r.dept}</td>
                      <td className="px-3 py-2 font-mono">{r.no_mat}</td>
                      <td className="px-3 py-2">{r.mat_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtIDR(r.diff1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtIDR(r.diff2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtIDR(r.diff3)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.pct3m === null ? "—" : `${r.pct3m.toFixed(2)}%`}</td>
                    </tr>
                  ))}
                  {props.under.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No continuous under-usage</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   Page
========================= */
export default function Actual() {
  const now = new Date();
  const [filters, setFilters] = useState<FilterState>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    deptMode: "all",
    material: "all",
  });

  const [graphMode, setGraphMode] = useState<GraphMode>("Combination");
  const [showDebug, setShowDebug] = useState<boolean>(false);

  // Dept options (shop.dept)
  const [deptOptions, setDeptOptions] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("shop").select("dept").not("dept", "is", null);
      if (!error && data) {
        const unique = Array.from(new Set((data as { dept: string | null }[])
          .map(r => (r.dept ?? "").trim())
          .filter(Boolean))).sort();
        if (!cancelled) setDeptOptions(unique);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Reference maps: master + shop
  const [masterMap, setMasterMap] = useState<Record<string, MasterRow>>({});
  const [shopMap, setShopMap] = useState<Record<string, number>>({}); // dept -> loc (1/2)

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [{ data: m }, { data: s }] = await Promise.all([
        supabase.from("master").select("no_mat, Price, qty, category, mat_name, UoM"),
        supabase.from("shop").select("dept, loc"),
      ]);
      if (cancel) return;

      const mm: Record<string, MasterRow> = {};
      (m ?? []).forEach((r: any) => {
        if (!r.no_mat) return;
        mm[String(r.no_mat)] = {
          no_mat: String(r.no_mat),
          price: safeNumber(r.Price),
          quantity: Math.max(1, safeNumber(r.qty, 1)),
          category: r.category ?? null,
          mat_name: r.mat_name ?? null,
          uom: r.UoM ?? null,
        };
      });
      setMasterMap(mm);

      const sm: Record<string, number> = {};
      (s ?? []).forEach((r: any) => {
        const dept = (r.dept ?? "").trim();
        if (!dept) return;
        sm[dept] = safeNumber(r.loc, 1);
      });
      setShopMap(sm);
    })();
    return () => { cancel = true; };
  }, []);

  // Calendars for the selected month
  const [cal1, setCal1] = useState<Record<string, number>>({});
  const [cal2, setCal2] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { start, end } = monthRange(filters.year, filters.month);
      const startStr = fmtDate(start);
      const endStr = fmtDate(end);
      const q1 = supabase.from("calender1").select("date, working_time, over_time").gte("date", startStr).lte("date", endStr);
      const q2 = supabase.from("calender2").select("date, working_time, over_time").gte("date", startStr).lte("date", endStr);
      const [{ data: c1 }, { data: c2 }] = await Promise.all([q1, q2]);
      if (cancel) return;

      const map1: Record<string, number> = {};
      let tot1 = 0;
      (c1 ?? []).forEach((r: any) => {
        const d = normalizeDateString(r.date);
        const wt = safeNumber(r.working_time);
        const ot = safeNumber(r.over_time);
        const w = wt + ot;
        if (d) { map1[d] = w; tot1 += w; }
      });

      const map2: Record<string, number> = {};
      let tot2 = 0;
      (c2 ?? []).forEach((r: any) => {
        const d = normalizeDateString(r.date);
        const wt = safeNumber(r.working_time);
        const ot = safeNumber(r.over_time);
        const w = wt + ot;
        if (d) { map2[d] = w; tot2 += w; }
      });

      const monthDates = listMonthDates(filters.year, filters.month);
      if (tot1 === 0) { monthDates.forEach(d => { map1[d] = 1; }); }
      if (tot2 === 0) { monthDates.forEach(d => { map2[d] = 1; }); }

      setCal1(map1);
      setCal2(map2);
    })();
    return () => { cancel = true; };
  }, [filters.year, filters.month]);

  // Actual + Forecast for month
  const [actualRows, setActualRows] = useState<ActualRow[]>([]);
  const [forecastRows, setForecastRows] = useState<ForecastRow[]>([]);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { start, end } = monthRange(filters.year, filters.month);
      const startStr = fmtDate(start);
      const endStr = fmtDate(end);
      const nextMonthStart = new Date(Date.UTC(filters.year, filters.month, 1));
      const nextStartStr = fmtDate(nextMonthStart);

      const qa = supabase
        .from("actual")
        .select("no_mat, posting_date, document_date, quantity, dept")
        .gte("posting_date", startStr)
        .lte("posting_date", endStr);

      const qf = supabase
        .from("forecast")
        .select("no_mat, shop, usage, month")
        .gte("month", startStr)
        .lt("month", nextStartStr);

      const [{ data: a }, { data: f }] = await Promise.all([qa, qf]);
      if (cancel) return;

      setActualRows((a ?? [])
        .map((r: any) => {
          const d = normalizeDateString(r.posting_date);
          const doc = normalizeDateString(r.document_date);
          return {
            no_mat: String(r.no_mat),
            posting_date: d ?? "",
            document_date: doc ?? null,
            quantity: safeNumber(r.quantity),
            dept: r.dept ?? null,
          };
        })
        .filter(r => !!r.posting_date));

      setForecastRows((f ?? []).map((r: any) => ({
        no_mat: String(r.no_mat),
        shop: r.shop ?? null,
        quantity: safeNumber(r.usage),
        month: normalizeDateString(r.month) ?? null,
      })));
    })();
    return () => { cancel = true; };
  }, [filters.year, filters.month]);

  /* =========================
     Shared filters + helpers
  ========================= */
  const deptSet = useMemo(() => new Set(deptOptions), [deptOptions]);

  const isDeptAllowed = useCallback((rowDept: string | null, rowShop: string | null) => {
    if (filters.deptMode === "all") return true;
    if (filters.deptMode === "list") {
      const target = (filters.deptSelected ?? "").trim();
      return (rowDept?.trim() === target) || (rowShop?.trim() === target);
    }
    const v = (rowDept ?? rowShop ?? "").trim();
    return v === "" || !deptSet.has(v);
  }, [filters.deptMode, filters.deptSelected, deptSet]);

  const isMaterialAllowed = useCallback((no_mat: string) => {
    const norm = normalizeCategory(masterMap[no_mat]?.category);
    if (filters.material === "all") return true;
    if (filters.material === "Unassigned") return norm === "Unassigned";
    return norm === filters.material;
  }, [filters.material, masterMap]);

  const vpu = useCallback((no_mat: string) => {
    const m = masterMap[no_mat];
    if (!m) return 0;
    return safeNumber(m.price) / Math.max(1, safeNumber(m.quantity, 1));
  }, [masterMap]);

  /* =========================
     Filtered tables
  ========================= */
  const filteredActual = useMemo(() => {
    return actualRows.filter(r =>
      isMaterialAllowed(r.no_mat) &&
      isDeptAllowed(r.dept, null)
    ).map(r => ({
      posting_date: r.posting_date,
      no_mat: r.no_mat,
      dept: r.dept ?? "",
      quantity: r.quantity,
      value: Number((r.quantity * vpu(r.no_mat)).toFixed(2)),
    }));
  }, [actualRows, isDeptAllowed, isMaterialAllowed, vpu]);

  const filteredForecast = useMemo(() => {
    return forecastRows.filter(r =>
      isMaterialAllowed(r.no_mat) &&
      isDeptAllowed(null, r.shop)
    ).map(r => ({
      shop: r.shop ?? "",
      loc: shopMap[(r.shop ?? "").trim()] ?? 1,
      no_mat: r.no_mat,
      quantity: r.quantity,
      value: Number((r.quantity * vpu(r.no_mat)).toFixed(2)),
    }));
  }, [forecastRows, isDeptAllowed, isMaterialAllowed, shopMap, vpu]);

  // Pagination
  const [pageA, setPageA] = useState(1);
  const [pageF, setPageF] = useState(1);
  const [pageSizeA, setPageSizeA] = useState(20);
  const [pageSizeF, setPageSizeF] = useState(20);

  useEffect(() => { setPageA(1); setPageF(1); }, [filters, filteredActual.length, filteredForecast.length]);

  const pagedActual = useMemo(() => {
    const start = (pageA - 1) * pageSizeA;
    return filteredActual.slice(start, start + pageSizeA);
  }, [filteredActual, pageA, pageSizeA]);

  const pagedForecast = useMemo(() => {
    const start = (pageF - 1) * pageSizeF;
    return filteredForecast.slice(start, start + pageSizeF);
  }, [filteredForecast, pageF, pageSizeF]);

  const pagesA = Math.max(1, Math.ceil(filteredActual.length / pageSizeA));
  const pagesF = Math.max(1, Math.ceil(filteredForecast.length / pageSizeF));

  /* =========================
     GRAPH AGGREGATION
  ========================= */
  const graphModeDates = useMemo(() => listMonthDates(filters.year, filters.month), [filters.year, filters.month]);

  const weights = useMemo(() => {
    const dates = graphModeDates;
    const w1 = dates.map(d => cal1[d] ?? 0);
    const w2 = dates.map(d => cal2[d] ?? 0);
    const s1 = w1.reduce((a, b) => a + b, 0) || 1;
    const s2 = w2.reduce((a, b) => a + b, 0) || 1;
    return {
      dates,
      w1: w1.map(x => x / s1),
      w2: w2.map(x => x / s2),
    };
  }, [graphModeDates, cal1, cal2]);

  const graphData = useMemo(() => {
    const { dates, w1, w2 } = weights;
    const n = dates.length;

    // Actual daily value, then cumulative
    const actualDaily = new Array(n).fill(0);
    for (const r of filteredActual) {
      const idx = dates.indexOf(r.posting_date);
      if (idx >= 0) actualDaily[idx] += r.value;
    }
    const cumActualByIdx = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      cumActualByIdx[i] = +((i ? cumActualByIdx[i - 1] : 0) + actualDaily[i]).toFixed(2);
    }

    // Forecast cumulative with pack rounding (ceil/floor) on cumulative units per material
    const cumMidByIdx   = new Array(n).fill(0); // cumulative mid value
    const cumLowerByIdx = new Array(n).fill(0); // cumulative floor by pack
    const cumUpperByIdx = new Array(n).fill(0); // cumulative ceil  by pack

    for (const r of filteredForecast) {
      const weightsArr = r.loc === 2 ? w2 : w1;
      const pack = Math.max(1, safeNumber(masterMap[r.no_mat]?.quantity, 1)); // master.qty
      const unitPrice = vpu(r.no_mat);

      let cumUnits = 0;
      for (let i = 0; i < n; i++) {
        const dayUnits = r.quantity * weightsArr[i]; // unrounded units
        cumUnits += dayUnits;

        const floorUnits = Math.floor(cumUnits / pack) * pack;
        const ceilUnits  = Math.ceil(cumUnits / pack) * pack;

        cumMidByIdx[i]   += cumUnits   * unitPrice;
        cumLowerByIdx[i] += floorUnits * unitPrice;
        cumUpperByIdx[i] += ceilUnits  * unitPrice;
      }
    }

    const dailyMidByIdx = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const prev = i ? cumMidByIdx[i - 1] : 0;
      dailyMidByIdx[i] = +(cumMidByIdx[i] - prev).toFixed(2);
    }

    return dates.map((iso, i) => {
      const dateLabel = iso.slice(8, 10);
      const cumA  = +cumActualByIdx[i].toFixed(2);
      const cumM  = +cumMidByIdx[i].toFixed(2);
      const cumLo = +cumLowerByIdx[i].toFixed(2);
      const cumUp = +cumUpperByIdx[i].toFixed(2);

      const bandBottom = +(cumM - cumLo).toFixed(2);
      const bandTop    = +(cumUp - cumM).toFixed(2);

      return {
        date: dateLabel,
        actual: +actualDaily[i].toFixed(2),
        forecast: dailyMidByIdx[i],
        cumActual: cumA,
        cumForecast: cumM,
        cumForecastLower: cumLo,
        cumForecastUpper: cumUp,
        bandBottom,
        bandTop,
      };
    });
  }, [weights, filteredActual, filteredForecast, masterMap, vpu]);

  const sumA = useMemo(() => graphData.reduce((s, r) => s + r.actual, 0), [graphData]);
  const sumF = useMemo(() => graphData.reduce((s, r) => s + r.forecast, 0), [graphData]);

  /* =========================
     Month totals per dept+material (values in IDR)
  ========================= */
  const monthTotalsByDeptMat = useMemo(() => {
    const agg = new Map<string, {
      dept: string;
      no_mat: string;
      mat_name: string;
      forecastValue: number;
      actualValue: number;
    }>();

    // Forecast totals
    for (const r of filteredForecast) {
      const dept = (r.shop ?? "").trim() || "—";
      const key = `${dept}|${r.no_mat}`;
      const unitPrice = vpu(r.no_mat);
      const cur = agg.get(key) ?? { dept, no_mat: r.no_mat, mat_name: masterMap[r.no_mat]?.mat_name ?? "", forecastValue: 0, actualValue: 0 };
      cur.forecastValue += r.quantity * unitPrice;
      agg.set(key, cur);
    }

    // Actual totals
    for (const r of filteredActual) {
      const dept = (r.dept ?? "").trim() || "—";
      const key = `${dept}|${r.no_mat}`;
      const unitPrice = vpu(r.no_mat);
      const cur = agg.get(key) ?? { dept, no_mat: r.no_mat, mat_name: masterMap[r.no_mat]?.mat_name ?? "", forecastValue: 0, actualValue: 0 };
      cur.actualValue += r.quantity * unitPrice;
      agg.set(key, cur);
    }

    return agg;
  }, [filteredForecast, filteredActual, masterMap, vpu]);

  /* =========================
     Over / Under tables
  ========================= */
  const overUsageRows = useMemo(() => {
    const rows: { dept: string; no_mat: string; mat_name: string; diff: number }[] = [];
    for (const [, v] of monthTotalsByDeptMat) {
      const diff = +(v.actualValue - v.forecastValue).toFixed(2);
      if (diff > 0) rows.push({ dept: v.dept, no_mat: v.no_mat, mat_name: v.mat_name, diff });
    }
    return rows.sort((a, b) => b.diff - a.diff);
  }, [monthTotalsByDeptMat]);

  const underUsageRows = useMemo(() => {
    const rows: { dept: string; no_mat: string; mat_name: string; diff: number }[] = [];
    for (const [, v] of monthTotalsByDeptMat) {
      const diff = +((v.forecastValue - v.actualValue)).toFixed(2);
      if (diff > 0) rows.push({ dept: v.dept, no_mat: v.no_mat, mat_name: v.mat_name, diff });
    }
    return rows.sort((a, b) => b.diff - a.diff);
  }, [monthTotalsByDeptMat]);

  /* =========================
     Delay transactions (posting_date < document_date)
  ========================= */
  const delayedTransactions = useMemo(() => {
    const out: { no_mat: string; mat_name: string; shop: string; quantity: number; delayedDays: number }[] = [];
    for (const r of actualRows) {
      if (!r.document_date) continue;
      const post = new Date(r.posting_date);
      const doc  = new Date(r.document_date);
      if (post.getTime() < doc.getTime()) {
        const ms = doc.getTime() - post.getTime();
        const days = Math.ceil(ms / (1000*60*60*24));
        out.push({
          no_mat: r.no_mat,
          mat_name: masterMap[r.no_mat]?.mat_name ?? "",
          shop: (r.dept ?? "").trim() || "—",
          quantity: r.quantity,
          delayedDays: days,
        });
      }
    }
    return out.sort((a, b) => b.delayedDays - a.delayedDays);
  }, [actualRows, masterMap]);

  /* =========================
     Dept summary (toggle) + compute
  ========================= */
  const [showDeptSummary, setShowDeptSummary] = useState(false);
  const deptSummary = useMemo(() => {
    const byDept = new Map<string, { dept: string; forecast: number; actual: number }>();
    for (const [, v] of monthTotalsByDeptMat) {
      const cur = byDept.get(v.dept) ?? { dept: v.dept, forecast: 0, actual: 0 };
      cur.forecast += v.forecastValue;
      cur.actual   += v.actualValue;
      byDept.set(v.dept, cur);
    }
    return Array.from(byDept.values()).map(d => ({
      ...d,
      usagePct: d.forecast > 0 ? +((d.actual / d.forecast) * 100).toFixed(2) : null
    })).sort((a,b)=> (b.actual - b.forecast) - (a.actual - a.forecast));
  }, [monthTotalsByDeptMat]);

  /* =========================
     Last 3 months + continuous over/under
  ========================= */
  const [actual3m, setActual3m] = useState<ActualRow[]>([]);
  const [forecast3m, setForecast3m] = useState<ForecastRow[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const start3 = new Date(Date.UTC(filters.year, filters.month - 3, 1));
      const nextMonthStart = new Date(Date.UTC(filters.year, filters.month, 1));
      const end3 = new Date(nextMonthStart.getTime() - 24*60*60*1000);

      const startStr = fmtDate(start3);
      const endStr   = fmtDate(end3);
      const nextStr  = fmtDate(nextMonthStart);

      const qa3 = supabase.from("actual")
        .select("no_mat, posting_date, document_date, quantity, dept")
        .gte("posting_date", startStr)
        .lte("posting_date", endStr);

      const qf3 = supabase.from("forecast")
        .select("no_mat, shop, usage, month")
        .gte("month", startStr)
        .lt("month", nextStr);

      const [{ data: a3 }, { data: f3 }] = await Promise.all([qa3, qf3]);
      if (cancel) return;

      const mappedA = (a3 ?? []).map((r:any) => ({
        no_mat: String(r.no_mat),
        posting_date: normalizeDateString(r.posting_date) ?? "",
        document_date: normalizeDateString(r.document_date) ?? null,
        quantity: safeNumber(r.quantity),
        dept: r.dept ?? null,
      })).filter(r => !!r.posting_date);

      const mappedF = (f3 ?? []).map((r:any) => ({
        no_mat: String(r.no_mat),
        shop: r.shop ?? null,
        quantity: safeNumber(r.usage),
        month: normalizeDateString(r.month) ?? null,
      }));

      setActual3m(mappedA);
      setForecast3m(mappedF);
    })();
    return () => { cancel = true; };
  }, [filters.year, filters.month]);

  const [showContinuous, setShowContinuous] = useState(false);
  const ymKey = (iso: string) => iso.slice(0, 7); // YYYY-MM
  const threeMonthKeys = useMemo(() => {
    const ymCur = ymKey(fmtDate(new Date(Date.UTC(filters.year, filters.month - 1, 1))));
    const d1 = new Date(Date.UTC(filters.year, filters.month - 2, 1));
    const d2 = new Date(Date.UTC(filters.year, filters.month - 3, 1));
    return [ymKey(fmtDate(d2)), ymKey(fmtDate(d1)), ymCur];
  }, [filters.year, filters.month]);

  type DiffRec = {
    dept: string;
    no_mat: string;
    mat_name: string;
    diff1: number; // -2M (A-F)
    diff2: number; // -1M
    diff3: number; // this month
    pct3m: number | null; // (sumA / sumF) * 100
  };

  const { continuousOver, continuousUnder } = useMemo(() => {
    const fMap = new Map<string, number>(); // `${ym}|${dept}|${no_mat}` => IDR
    for (const r of forecast3m) {
      const ym = r.month ? ymKey(r.month) : "";
      if (!ym || !threeMonthKeys.includes(ym)) continue;
      const dept = (r.shop ?? "").trim() || "—";
      const key = `${ym}|${dept}|${r.no_mat}`;
      const unitPrice = vpu(r.no_mat);
      fMap.set(key, (fMap.get(key) ?? 0) + r.quantity * unitPrice);
    }

    const aMap = new Map<string, number>();
    for (const r of actual3m) {
      const ym = ymKey(r.posting_date);
      if (!threeMonthKeys.includes(ym)) continue;
      const dept = (r.dept ?? "").trim() || "—";
      const key = `${ym}|${dept}|${r.no_mat}`;
      const unitPrice = vpu(r.no_mat);
      aMap.set(key, (aMap.get(key) ?? 0) + r.quantity * unitPrice);
    }

    const combos = new Map<string, { dept: string; no_mat: string }>();
    const pushCombo = (ym:string, dept:string, no:string) => {
      if (!threeMonthKeys.includes(ym)) return;
      combos.set(`${dept}|${no}`, { dept, no_mat: no });
    };
    for (const k of fMap.keys()) { const [ym, dept, no] = k.split("|"); pushCombo(ym, dept, no); }
    for (const k of aMap.keys()) { const [ym, dept, no] = k.split("|"); pushCombo(ym, dept, no); }

    const over: DiffRec[] = [];
    const under: DiffRec[] = [];

    for (const { dept, no_mat } of combos.values()) {
      const mat_name = masterMap[no_mat]?.mat_name ?? "";
      const vals: number[] = [];
      const sums = { A: 0, F: 0 };

      threeMonthKeys.forEach((ym, i) => {
        const key = `${ym}|${dept}|${no_mat}`;
        const A = aMap.get(key) ?? 0;
        const F = fMap.get(key) ?? 0;
        vals[i] = +(A - F).toFixed(2);
        sums.A += A; sums.F += F;
      });

      const rec: DiffRec = {
        dept, no_mat, mat_name,
        diff1: vals[0] ?? 0,
        diff2: vals[1] ?? 0,
        diff3: vals[2] ?? 0,
        pct3m: sums.F > 0 ? +((sums.A / sums.F) * 100).toFixed(2) : null,
      };

      if (rec.diff1 > 0 && rec.diff2 > 0 && rec.diff3 > 0) over.push(rec);
      if (rec.diff1 < 0 && rec.diff2 < 0 && rec.diff3 < 0) under.push(rec);
    }

    over.sort((a,b)=> b.diff3 - a.diff3 || (b.pct3m ?? -1) - (a.pct3m ?? -1));
    under.sort((a,b)=> Math.abs(b.diff3) - Math.abs(a.diff3) || (a.pct3m ?? -1) - (b.pct3m ?? -1));

    return { continuousOver: over, continuousUnder: under };
  }, [forecast3m, actual3m, threeMonthKeys, masterMap, vpu]);

  /* =========================
     UI
  ========================= */
  return (
    <div className="min-h-dvh grid grid-cols-[260px_1fr]">
      <aside className="border-r bg-white dark:bg-slate-900 sticky top-0 h-dvh overflow-y-auto">
        <Navigation />
      </aside>

      <main className="min-w-0 overflow-x-hidden">
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
          <div className="container mx-auto p-6 space-y-6 max-w-[1400px]">
            {/* Filters */}
            <Card className="border-dashed shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold tracking-tight">Filters</CardTitle>
              </CardHeader>
              <CardContent>
                <FiltersUI filters={filters} setFilters={setFilters} deptOptions={deptOptions} />
              </CardContent>
            </Card>

            {/* Debug tables toggle */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Debugging: filtered data preview (forecast vs actual)</div>
              <div className="flex items-center gap-2">
                <Label className="mr-2">Show tables</Label>
                <Button variant="outline" size="sm" onClick={() => setShowDebug((s) => !s)} className="gap-2">
                  {showDebug ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showDebug ? "Hide" : "Show"}
                </Button>
              </div>
            </div>

            {/* Debug tables */}
            {showDebug && (
              <Card>
                <CardHeader>
                  <CardTitle>Filtered Material — Debug</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Forecast */}
                    <div className="min-w-0">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-medium">Forecast ({filteredForecast.length})</div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">Rows per page</Label>
                          <Select value={String(pageSizeF)} onValueChange={(v) => { setPageSizeF(Number(v)); setPageF(1); }}>
                            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="10">10</SelectItem>
                              <SelectItem value="20">20</SelectItem>
                              <SelectItem value="50">50</SelectItem>
                            </SelectContent>
                          </Select>
                          <div className="text-xs text-muted-foreground">Page {pageF} / {pagesF}</div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setPageF(p => Math.max(1, p - 1))}>Prev</Button>
                            <Button variant="outline" size="sm" onClick={() => setPageF(p => Math.min(pagesF, p + 1))}>Next</Button>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border overflow-auto max-h=[360px] lg:max-h-[360px]">
                        <Table className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background [&_tbody_tr:nth-child(even)]:bg-muted/30">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Shop</TableHead>
                              <TableHead>Dept Loc</TableHead>
                              <TableHead>No Mat</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead className="text-right">Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pagedForecast.map((r) => (
                              <TableRow key={`${r.shop ?? "NA"}:${r.no_mat}`}>
                                <TableCell>{r.shop}</TableCell>
                                <TableCell>{r.loc}</TableCell>
                                <TableCell className="font-mono">{r.no_mat}</TableCell>
                                <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                                <TableCell className="text-right tabular-nums">{fmtIDR(r.value)}</TableCell>
                              </TableRow>
                            ))}
                            {pagedForecast.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No data</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {/* Actual */}
                    <div className="min-w-0">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-medium">Actual ({filteredActual.length})</div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">Rows per page</Label>
                          <Select value={String(pageSizeA)} onValueChange={(v) => { setPageSizeA(Number(v)); setPageA(1); }}>
                            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="10">10</SelectItem>
                              <SelectItem value="20">20</SelectItem>
                              <SelectItem value="50">50</SelectItem>
                            </SelectContent>
                          </Select>
                          <div className="text-xs text-muted-foreground">Page {pageA} / {pagesA}</div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setPageA(p => Math.max(1, p - 1))}>Prev</Button>
                            <Button variant="outline" size="sm" onClick={() => setPageA(p => Math.min(pagesA, p + 1))}>Next</Button>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border overflow-auto max-h=[360px] lg:max-h-[360px]">
                        <Table className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background [&_tbody_tr:nth-child(even)]:bg-muted/30">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Dept</TableHead>
                              <TableHead>No Mat</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead className="text-right">Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pagedActual.map((r) => (
                              <TableRow key={`${r.posting_date}:${r.no_mat}`}>
                                <TableCell className="font-mono">{r.posting_date}</TableCell>
                                <TableCell>{r.dept}</TableCell>
                                <TableCell className="font-mono">{r.no_mat}</TableCell>
                                <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                                <TableCell className="text-right tabular-nums">{fmtIDR(r.value)}</TableCell>
                              </TableRow>
                            ))}
                            {pagedActual.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No data</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* KPIs + Graphs */}
            <Card>
              <CardHeader className="flex items-center justify-between gap-4">
                <CardTitle>Graphs</CardTitle>
                <div className="flex items-center gap-3">
                  <Label>Graph</Label>
                  <Select value={graphMode} onValueChange={(v) => setGraphMode(v as GraphMode)}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Combination">Combination</SelectItem>
                      <SelectItem value="Daily Control">Daily Control</SelectItem>
                      <SelectItem value="Accumulative Control">Accumulative Control</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: "Actual (MTD)", value: sumA },
                    { label: "Forecast (MTD)", value: sumF },
                    { label: "Gap (A - F)", value: sumA - sumF },
                  ].map(k => (
                    <div
                      key={k.label}
                      className={cn(
                        "rounded-2xl border p-4",
                        k.label === "Gap (A - F)" && (k.value >= 0
                          ? "bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200/50"
                          : "bg-rose-50/60 dark:bg-rose-950/30 border-rose-200/50")
                      )}
                    >
                      <div className="text-xs text-muted-foreground">{k.label}</div>
                      <div className="text-lg font-semibold tracking-tight">{fmtIDR(k.value)}</div>
                    </div>
                  ))}
                </div>

                <GraphBlock mode={graphMode} data={graphData} />

                <div className="text-xs text-muted-foreground">
                  days: {graphData.length} • sumA: {fmtIDR(sumA)} • sumF: {fmtIDR(sumF)}
                </div>

                {/* Anomaly tables */}
                <AnomalyTables
                  over={overUsageRows}
                  under={underUsageRows}
                  delays={delayedTransactions}
                />

                {/* Dept summary (toggle) */}
                <DeptSummaryBlock
                  show={showDeptSummary}
                  setShow={setShowDeptSummary}
                  rows={deptSummary}
                />

                {/* Continuous Over/Under (toggle) */}
                <ContinuousUsageBlock
                  show={showContinuous}
                  setShow={setShowContinuous}
                  over={continuousOver}
                  under={continuousUnder}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
