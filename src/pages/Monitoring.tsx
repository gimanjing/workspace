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
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
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
interface ActualRow { no_mat: string; posting_date: string; quantity: number; dept: string | null }
interface ForecastRow { no_mat: string; shop: string | null; quantity: number; month?: string | null }

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
  const [cal1Total, setCal1Total] = useState(0);
  const [cal2Total, setCal2Total] = useState(0);

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

      // fallback to uniform monthly spread if needed
      const monthDates = listMonthDates(filters.year, filters.month);
      if (tot1 === 0) { monthDates.forEach(d => { map1[d] = 1; }); tot1 = monthDates.length; }
      if (tot2 === 0) { monthDates.forEach(d => { map2[d] = 1; }); tot2 = monthDates.length; }

      setCal1(map1); setCal1Total(tot1);
      setCal2(map2); setCal2Total(tot2);
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

      const qa = supabase.from("actual")
        .select("no_mat, posting_date, quantity, dept")
        .gte("posting_date", startStr)
        .lte("posting_date", endStr);

      const qf = supabase.from("forecast")
        .select("no_mat, shop, usage, month")
        .gte("month", startStr)
        .lt("month", nextStartStr);

      const [{ data: a }, { data: f }] = await Promise.all([qa, qf]);
      if (cancel) return;

      setActualRows((a ?? []).map((r: any) => {
        const d = normalizeDateString(r.posting_date);
        return {
          no_mat: String(r.no_mat),
          posting_date: d ?? "",
          quantity: safeNumber(r.quantity),
          dept: r.dept ?? null,
        };
      }).filter(r => !!r.posting_date));

      setForecastRows((f ?? []).map((r: any) => ({
        no_mat: String(r.no_mat),
        shop: r.shop ?? null,
        quantity: safeNumber(r.usage),   // usage -> quantity
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
     DEBUG DATA
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

    const actualByIdx = new Array(dates.length).fill(0);
    for (const r of filteredActual) {
      const idx = dates.indexOf(r.posting_date);
      if (idx >= 0) actualByIdx[idx] += r.value;
    }

    const forecastByIdx = new Array(dates.length).fill(0);
    for (const r of filteredForecast) {
      const arr = (r.loc === 2) ? w2 : w1;
      const add = r.value;
      for (let i = 0; i < arr.length; i++) forecastByIdx[i] += add * arr[i];
    }

    let cumA = 0, cumF = 0;
    return dates.map((iso, i) => {
      const a = +actualByIdx[i].toFixed(2);
      const f = +forecastByIdx[i].toFixed(2);
      cumA = +(cumA + a).toFixed(2);
      cumF = +(cumF + f).toFixed(2);
      return {
        date: iso.slice(8, 10),
        actual: a,
        forecast: f,
        cumActual: cumA,
        cumForecast: cumF,
      };
    });
  }, [weights, filteredActual, filteredForecast]);

  const sumA = useMemo(()=>graphData.reduce((s,r)=>s+r.actual,0),[graphData]);
  const sumF = useMemo(()=>graphData.reduce((s,r)=>s+r.forecast,0),[graphData]);

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
              <div className="text-sm text-muted-foreground">
                Debugging: filtered data preview (forecast vs actual)
              </div>
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
                      <div className="rounded-xl border overflow-auto max-h-[360px]">
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
                      <div className="rounded-xl border overflow-auto max-h-[360px]">
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
          <Button variant="outline" className="gap-2 h-9" onClick={() => setFilters(f => ({ ...f, month: now.getMonth() + 1, year: now.getFullYear() }))}>
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
   Graph Block (shadcn-themed)
========================= */
function GraphBlock({ mode, data }: { mode: GraphMode; data: any[] }) {
  // Use shadcn CSS tokens so colors track theme
  const BLUE  = "hsl(var(--chart-1))"; // Actual
  const GREEN = "hsl(var(--chart-2))"; // Forecast

  // Tailored tooltip that uses shadcn surfaces
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
        {"Cum Forecast" in map && <div className="text-xs">Cum F: <span className="font-mono">{fmtIDR(map["Cum Forecast"])}</span></div>}
      </div>
    );
  };

  if (mode === "Daily Control") {
    return (
      <div className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis dataKey="date" />
            <YAxis />
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
    return (
      <div className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Line type="monotone" dataKey="cumActual"   name="Cum Actual"   dot={false} strokeWidth={2} stroke={BLUE}  />
            <Line type="monotone" dataKey="cumForecast" name="Cum Forecast" dot={false} strokeWidth={2} stroke={GREEN} />
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
          <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
          <XAxis dataKey="date" />
          <YAxis yAxisId="left" />
          <YAxis yAxisId="right" orientation="right" />
          <Tooltip content={<ChartTooltip />} />
          <Legend />
          <Bar  yAxisId="left"  dataKey="actual"      name="Actual"            fill={BLUE}  stroke={BLUE}  radius={[6,6,0,0]} />
          <Bar  yAxisId="left"  dataKey="forecast"    name="Forecast"          fill={GREEN} stroke={GREEN} radius={[6,6,0,0]} />
          <Line yAxisId="right" type="monotone" dataKey="cumActual"   name="Cum Actual"   dot={false} strokeWidth={2} stroke={BLUE}  />
          <Line yAxisId="right" type="monotone" dataKey="cumForecast" name="Cum Forecast" dot={false} strokeWidth={2} stroke={GREEN} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
