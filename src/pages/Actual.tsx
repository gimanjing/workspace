// app/actual/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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

// shadcn table
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// recharts
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

/* =========================
   Types
========================= */
interface MasterRow { no_mat: string; price: number; quantity: number; category: string | null }
interface ActualRow  { no_mat: string; posting_date: string; quantity: number; dept: string | null }
interface ForecastRow {
  no_mat: string;          // normalized
  shop: string | null;     // normalized dept name
  usage: number;           // monthly usage
  month: string | null;    // "YYYY-MM"
  month_label?: string | null;
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
   Helpers
========================= */
const fmtDate = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD
const ymOf = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

function monthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
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
// Normalize odd date strings like "20225-09-01" or "20250901" to "YYYY-MM-DD"
function normalizeDateString(x: any): string | null {
  if (!x) return null;
  const s = String(x);
  const m = s.match(/(\d{4,5})-(\d{2})-(\d{2})/);
  if (m) {
    const yyyy = m[1].slice(-4);
    return `${yyyy}-${m[2]}-${m[3]}`;
  }
  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}
function safeNumber(n: any, d = 0) { const x = Number(n); return Number.isFinite(x) ? x : d; }

// string/keys normalizers
const keyNM    = (x: any) => String(x ?? "").trim().toUpperCase(); // for no_mat join
const norm     = (x: any) => String(x ?? "").trim();               // for dept/shop
const normLower= (x: any) => norm(x).toLowerCase();

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
  const [showDebug, setShowDebug] = useState(false);

  // dept options from shop.dept
  const [deptOptions, setDeptOptions] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("shop").select("dept").not("dept", "is", null);
      if (error) { console.error(error); return; }
      if (cancelled) return;
      const unique = Array.from(new Set((data ?? []).map((r: any) => norm(r.dept)).filter(Boolean))).sort();
      setDeptOptions(unique);
    })();
    return () => { cancelled = true; };
  }, []);

  // master map (no_mat -> MasterRow), and shop map (dept -> loc)
  const [masterMap, setMasterMap] = useState<Record<string, MasterRow>>({});
  const [shopMap, setShopMap] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancel = false;
    (async () => {
      const [{ data: m }, { data: s }] = await Promise.all([
        supabase.from("master").select("no_mat, price, quantity, category"),
        supabase.from("shop").select("dept, loc"),
      ]);
      if (cancel) return;

      const mm: Record<string, MasterRow> = {};
      (m ?? []).forEach((r: any) => {
        const k = keyNM(r.no_mat);
        if (!k) return;
        mm[k] = {
          no_mat: k,
          price: safeNumber(r.price),
          quantity: Math.max(1, safeNumber(r.quantity, 1)),
          category: r.category ?? null,
        };
      });
      setMasterMap(mm);

      const sm: Record<string, number> = {};
      (s ?? []).forEach((r: any) => {
        const dept = norm(r.dept);
        if (!dept) return;
        sm[dept] = safeNumber(r.loc, 1);
      });
      setShopMap(sm);
    })();
    return () => { cancel = true; };
  }, []);

  // calendars for selected month
  const [cal1, setCal1] = useState<Record<string, number>>({});
  const [cal2, setCal2] = useState<Record<string, number>>({});
  const [cal1Total, setCal1Total] = useState(0);
  const [cal2Total, setCal2Total] = useState(0);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { start, end } = monthRange(filters.year, filters.month);
      const startStr = fmtDate(start), endStr = fmtDate(end);
      const [{ data: c1 }, { data: c2 }] = await Promise.all([
        supabase.from("calender1").select("date, working_time, over_time").gte("date", startStr).lte("date", endStr),
        supabase.from("calender2").select("date, working_time, over_time").gte("date", startStr).lte("date", endStr),
      ]);
      if (cancel) return;

      const map1: Record<string, number> = {}; let tot1 = 0;
      (c1 ?? []).forEach((r: any) => {
        const d = normalizeDateString(r.date);
        const w = safeNumber(r.working_time) + safeNumber(r.over_time);
        if (d) { map1[d] = w; tot1 += w; }
      });

      const map2: Record<string, number> = {}; let tot2 = 0;
      (c2 ?? []).forEach((r: any) => {
        const d = normalizeDateString(r.date);
        const w = safeNumber(r.working_time) + safeNumber(r.over_time);
        if (d) { map2[d] = w; tot2 += w; }
      });

      // fallback to uniform monthly spread if totals are zero
      const monthDates = listMonthDates(filters.year, filters.month);
      if (tot1 === 0) { monthDates.forEach(d => { map1[d] = 1; }); tot1 = monthDates.length; }
      if (tot2 === 0) { monthDates.forEach(d => { map2[d] = 1; }); tot2 = monthDates.length; }

      setCal1(map1); setCal1Total(tot1);
      setCal2(map2); setCal2Total(tot2);
    })();
    return () => { cancel = true; };
  }, [filters.year, filters.month]);

  // load actual + forecast (forecast filtered by month)
  const [actualRows, setActualRows] = useState<ActualRow[]>([]);
  const [forecastRows, setForecastRows] = useState<ForecastRow[]>([]);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { start, end } = monthRange(filters.year, filters.month);
      const startStr = fmtDate(start), endStr = fmtDate(end);

      const ym = ymOf(filters.year, filters.month);

      const qa = supabase.from("actual")
        .select("no_mat, posting_date, quantity, dept")
        .gte("posting_date", startStr).lte("posting_date", endStr);

      const qf = supabase.from("forecast")
        .select("no_mat, shop, usage, month, month_label")
        .eq("month", ym);

      const [{ data: a, error: ea }, { data: f, error: ef }] = await Promise.all([qa, qf]);
      if (ea) console.error(ea);
      if (ef) console.error(ef);
      if (cancel) return;

      setActualRows((a ?? []).map((r: any) => {
        const d = normalizeDateString(r.posting_date);
        return {
          no_mat: keyNM(r.no_mat),
          posting_date: d ?? "",
          quantity: safeNumber(r.quantity),
          dept: norm(r.dept) || null,
        };
      }).filter(r => !!r.posting_date));

      setForecastRows((f ?? []).map((r: any) => ({
        no_mat: keyNM(r.no_mat),
        shop: norm(r.shop) || null,
        usage: safeNumber(r.usage),
        month: r.month ?? null,
        month_label: r.month_label ?? null,
      })));
    })();
    return () => { cancel = true; };
  }, [filters.year, filters.month]);

  /* =========================
     Filters & joins
  ========================= */
  const deptSet = useMemo(() => new Set(deptOptions.map(norm)), [deptOptions]);

  const isDeptAllowed = (rowDept: string | null, rowShop: string | null) => {
    if (filters.deptMode === "all") return true;
    if (filters.deptMode === "list") {
      const target = norm(filters.deptSelected);
      return norm(rowDept) === target || norm(rowShop) === target;
    }
    // unassigned
    const v = norm(rowDept ?? rowShop);
    return !!v && !deptSet.has(v);
  };

  const isMaterialAllowed = (no_mat: string) => {
    const m = masterMap[no_mat];
    const cat = normLower(m?.category);
    if (filters.material === "all") return true;
    if (filters.material === "Unassigned") {
      return !(cat === "direct material" || cat === "indirect material");
    }
    return cat === normLower(filters.material);
  };

  const vpu = (no_mat: string) => {
    const m = masterMap[no_mat];
    if (!m) return 0; // set to 1 for debugging if you want to see items missing in master
    return safeNumber(m.price) / Math.max(1, safeNumber(m.quantity, 1));
  };

  /* =========================
     DEBUG TABLES (filtered rows)
  ========================= */
  const filteredActual = useMemo(() => {
    return actualRows
      .filter(r => isMaterialAllowed(r.no_mat) && isDeptAllowed(r.dept, null))
      .map(r => ({
        posting_date: r.posting_date,
        no_mat: r.no_mat,
        dept: r.dept ?? "",
        quantity: r.quantity,
        value: Number((r.quantity * vpu(r.no_mat)).toFixed(2)),
      }));
  }, [actualRows, isDeptAllowed, isMaterialAllowed]);

  const filteredForecast = useMemo(() => {
    return forecastRows
      .filter(r => isMaterialAllowed(r.no_mat) && isDeptAllowed(null, r.shop))
      .map(r => ({
        shop: r.shop ?? "",
        loc: shopMap[norm(r.shop)] ?? 1,
        no_mat: r.no_mat,
        usage: r.usage,
        value: Number((r.usage * vpu(r.no_mat)).toFixed(2)),
      }));
  }, [forecastRows, isDeptAllowed, isMaterialAllowed, shopMap]);

  // pagination
  const [pageA, setPageA] = useState(1);
  const [pageF, setPageF] = useState(1);
  const [pageSizeA, setPageSizeA] = useState(20);
  const [pageSizeF, setPageSizeF] = useState(20);

  useEffect(() => { setPageA(1); setPageF(1); }, [filters, filteredActual.length, filteredForecast.length]);

  const pagesA = Math.max(1, Math.ceil(filteredActual.length / pageSizeA));
  const pagesF = Math.max(1, Math.ceil(filteredForecast.length / pageSizeF));

  const pagedActual = useMemo(() => {
    const start = (pageA - 1) * pageSizeA;
    return filteredActual.slice(start, start + pageSizeA);
  }, [filteredActual, pageA, pageSizeA]);

  const pagedForecast = useMemo(() => {
    const start = (pageF - 1) * pageSizeF;
    return filteredForecast.slice(start, start + pageSizeF);
  }, [filteredForecast, pageF, pageSizeF]);

  /* =========================
     Graph data
  ========================= */
  const dates = useMemo(() => listMonthDates(filters.year, filters.month), [filters.year, filters.month]);

  const graphData = useMemo(() => {
    const actualByDate: Record<string, number> = {};
    const forecastByDate: Record<string, number> = {};
    for (const d of dates) { actualByDate[d] = 0; forecastByDate[d] = 0; }

    // Actual: sum daily values
    filteredActual.forEach(r => {
      if (r.posting_date in actualByDate) {
        actualByDate[r.posting_date] += r.value;
      }
    });

    // Forecast: distribute monthly value by calendar weights
    filteredForecast.forEach(r => {
      const loc = r.loc === 2 ? 2 : 1;
      const cal   = loc === 2 ? cal2 : cal1;
      const total = loc === 2 ? cal2Total : cal1Total;
      const denom = total > 0 ? total : 1;
      dates.forEach(d => {
        const weight = cal[d] ?? 0;
        forecastByDate[d] += r.value * (weight / denom);
      });
    });

    // rows + cumulative
    let cumA = 0, cumF = 0;
    return dates.map(d => {
      const a = actualByDate[d] || 0;
      const f = forecastByDate[d] || 0;
      cumA += a; cumF += f;
      return {
        date: d.slice(8, 10),
        actual: Number(a.toFixed(2)),
        forecast: Number(f.toFixed(2)),
        cumActual: Number(cumA.toFixed(2)),
        cumForecast: Number(cumF.toFixed(2)),
      };
    });
  }, [dates, filteredActual, filteredForecast, cal1, cal2, cal1Total, cal2Total]);

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
          <div className="container mx-auto p-6 space-y-6">
            {/* Filters */}
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Filters</CardTitle>
              </CardHeader>
              <CardContent>
                <FiltersUI filters={filters} setFilters={setFilters} deptOptions={deptOptions} />
              </CardContent>
            </Card>

            {/* Debug toggle */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Debugging: filtered data preview (forecast vs actual)</div>
              <div className="flex items-center gap-2">
                <Label className="mr-2">Show tables</Label>
                <Button variant="outline" size="sm" onClick={() => setShowDebug(s => !s)} className="gap-2">
                  {showDebug ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showDebug ? "Hide" : "Show"}
                </Button>
              </div>
            </div>

            {/* Debug tables */}
            {showDebug && (
              <Card>
                <CardHeader><CardTitle>Filtered Material — Debug</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Forecast table */}
                    <DebugTable
                      title={`Forecast (${filteredForecast.length})`}
                      rows={pagedForecast}
                      totalRows={filteredForecast.length}
                      page={pageF}
                      pages={pagesF}
                      pageSize={pageSizeF}
                      setPage={setPageF}
                      setPageSize={setPageSizeF}
                      columns={[
                        { key: "shop", label: "Shop" },
                        { key: "loc",  label: "Dept Loc" },
                        { key: "no_mat", label: "No Mat", mono: true },
                        { key: "usage", label: "Usage", align: "right" },
                        { key: "value", label: "Value", align: "right", format: (v: any) => Number(v).toLocaleString() },
                      ]}
                    />

                    {/* Actual table */}
                    <DebugTable
                      title={`Actual (${filteredActual.length})`}
                      rows={pagedActual}
                      totalRows={filteredActual.length}
                      page={pageA}
                      pages={pagesA}
                      pageSize={pageSizeA}
                      setPage={setPageA}
                      setPageSize={setPageSizeA}
                      columns={[
                        { key: "posting_date", label: "Date", mono: true },
                        { key: "dept", label: "Dept" },
                        { key: "no_mat", label: "No Mat", mono: true },
                        { key: "quantity", label: "Qty", align: "right" },
                        { key: "value", label: "Value", align: "right", format: (v: any) => Number(v).toLocaleString() },
                      ]}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Graphs */}
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
                <GraphBlock mode={graphMode} data={graphData} />
                <div className="text-xs text-muted-foreground">
                  days: {graphData.length} • sumA: {graphData.reduce((s,r)=>s+r.actual,0).toFixed(2)} • sumF: {graphData.reduce((s,r)=>s+r.forecast,0).toFixed(2)}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

/* =========================
   Filters UI
========================= */
function FiltersUI({
  filters, setFilters, deptOptions,
}: {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  deptOptions: string[];
}) {
  const now = new Date();
  const [deptOpen, setDeptOpen] = useState(false);

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
          <Button variant="outline" className="gap-2" onClick={() => setFilters(f => ({ ...f, month: now.getMonth() + 1, year: now.getFullYear() }))}>
            <CalendarDays className="h-4 w-4" /> This month
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Applies to both <span className="font-mono">forecast</span> and <span className="font-mono">actual</span>.</p>
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
            <Popover open={deptOpen} onOpenChange={setDeptOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className={cn("w-56 justify-between", !filters.deptSelected && "text-muted-foreground")}
                >
                  {filters.deptSelected || "Select department"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-0">
                <Command>
                  <CommandInput placeholder="Search dept..." />
                  <CommandEmpty>No department found.</CommandEmpty>
                  <CommandGroup>
                    {deptOptions.map((dept) => (
                      <CommandItem
                        key={dept}
                        value={dept}
                        onSelect={(v) => { setFilters(f => ({ ...f, deptSelected: v })); setDeptOpen(false); }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", dept === filters.deptSelected ? "opacity-100" : "opacity-0")} />
                        {dept}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
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

/* =========================
   Reusable DebugTable
========================= */
function DebugTable({
  title, rows, totalRows, page, pages, pageSize, setPage, setPageSize,
  columns,
}: {
  title: string;
  rows: any[];
  totalRows: number;
  page: number;
  pages: number;
  pageSize: number;
  setPage: (n: number) => void;
  setPageSize: (n: number) => void;
  columns: { key: string; label: string; mono?: boolean; align?: "right"; format?: (v: any) => string }[];
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">{title}</div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Rows per page</Label>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">Page {page} / {pages}</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))}>Prev</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(Math.min(pages, page + 1))}>Next</Button>
          </div>
        </div>
      </div>
      <div className="rounded-lg border overflow-auto max-h-[360px]">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={c.align === "right" ? "text-right" : ""}>{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, idx) => (
              <TableRow key={idx}>
                {columns.map((c) => {
                  const val = r[c.key];
                  const text = c.format ? c.format(val) : String(val ?? "");
                  return (
                    <TableCell
                      key={c.key}
                      className={[
                        c.align === "right" ? "text-right" : "",
                        c.mono ? "font-mono" : "",
                      ].join(" ")}
                    >
                      {text}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-sm text-muted-foreground">No data</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* =========================
   Graph Block
========================= */
function GraphBlock({ mode, data }: { mode: GraphMode; data: any[] }) {
  if (mode === "Daily Control") {
    return (
      <div className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="actual" name="Actual" />
            <Bar dataKey="forecast" name="Forecast" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (mode === "Accumulative Control") {
    return (
      <div className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="cumActual" name="Cum Actual" />
            <Line type="monotone" dataKey="cumForecast" name="Cum Forecast" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Combination
  return (
    <div className="h-[460px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis yAxisId="left" />
          <YAxis yAxisId="right" orientation="right" />
          <Tooltip />
          <Legend />
          <Bar yAxisId="left" dataKey="actual" name="Actual (Daily)" />
          <Bar yAxisId="left" dataKey="forecast" name="Forecast (Daily)" />
          <Line yAxisId="right" type="monotone" dataKey="cumActual" name="Cum Actual" />
          <Line yAxisId="right" type="monotone" dataKey="cumForecast" name="Cum Forecast" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
