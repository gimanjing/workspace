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
import { CalendarDays, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

// ------------------ Types ------------------
interface ShopRow { dept: string | null }
interface FilterState {
  month: number; // 1-12
  year: number;  // YYYY
  deptMode: "all" | "list" | "unassigned";
  deptSelected?: string; // only when deptMode === 'list'
  material: "all" | "Direct Material" | "Indirect Material" | "Unassigned";
}

// ------------------ Constants ------------------
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 7 }, (_, i) => THIS_YEAR - 3 + i); // [y-3 .. y+3]
const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" }, { value: 3, label: "March" },
  { value: 4, label: "April" },   { value: 5, label: "May" },      { value: 6, label: "June" },
  { value: 7, label: "July" },    { value: 8, label: "August" },   { value: 9, label: "September" },
  { value: 10, label: "October" },{ value: 11, label: "November" },{ value: 12, label: "December" },
];

// ------------------ Page ------------------
export default function Actual() {
  return (
    <div className="min-h-dvh grid grid-cols-[260px_1fr]">
      <aside className="border-r bg-white dark:bg-slate-900 sticky top-0 h-dvh overflow-y-auto">
        <Navigation />
      </aside>

      <main className="min-w-0 overflow-x-hidden">
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
          <div className="container mx-auto p-6">
            <Card>
              <CardHeader>
                <CardTitle>Monitoring</CardTitle>
              </CardHeader>
              <CardContent>
                <MonitoringFilters
                  onChange={(f) => {
                    // PHASE 2 HOOK:
                    // Use f.month, f.year, f.deptMode, f.deptSelected, f.material
                    // to query `forecast` and `actual` for that period + filters.
                    // fetchFilteredData(f)
                    console.log("filters:", f);
                  }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

// ------------------ Filters Component ------------------
function MonitoringFilters({
  defaultMonth,
  defaultYear,
  onChange,
}: {
  defaultMonth?: number;
  defaultYear?: number;
  onChange?: (f: FilterState) => void;
}) {
  const now = new Date();
  const [filters, setFilters] = useState<FilterState>({
    month: defaultMonth ?? now.getMonth() + 1,
    year: defaultYear ?? now.getFullYear(),
    deptMode: "all",
    material: "all",
  });

  // Dept options from shop.dept
  const [deptOptions, setDeptOptions] = useState<string[]>([]);
  const [deptOpen, setDeptOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("shop")
        .select("dept")
        .not("dept", "is", null);
      if (error) {
        console.error("Failed loading depts:", error);
        return;
      }
      if (cancelled) return;
      const unique = Array.from(
        new Set((data as ShopRow[]).map(r => (r.dept ?? "").trim()).filter(Boolean))
      ).sort();
      setDeptOptions(unique);
    })();
    return () => { cancelled = true; };
  }, []);

  // Notify parent on change
  useEffect(() => { onChange?.(filters); }, [filters, onChange]);

  const monthLabel = useMemo(
    () => MONTHS.find(m => m.value === filters.month)?.label ?? "",
    [filters.month]
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-12">
        {/* Month selector */}
        <div className="md:col-span-4 space-y-2">
          <Label>Month</Label>
          <div className="flex gap-2">
            <Select value={String(filters.month)} onValueChange={(v) => setFilters(f => ({ ...f, month: Number(v) }))}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map(m => (
                  <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(filters.year)} onValueChange={(v) => setFilters(f => ({ ...f, year: Number(v) }))}>
              <SelectTrigger className="w-28">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map(y => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="gap-2"
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
            <Select
              value={filters.deptMode}
              onValueChange={(v: FilterState["deptMode"]) => setFilters(f => ({ ...f, deptMode: v }))}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="list">List</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
              </SelectContent>
            </Select>

            {/* Dept picker shows only when mode === 'list' */}
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
            Source list from <span className="font-mono">shop.dept</span>; “Unassigned” will later mean rows in
            <span className="font-mono"> forecast.shop </span> / <span className="font-mono">actual.dept</span> that aren’t in
            <span className="font-mono"> shop.dept</span>.
          </p>
        </div>

        {/* Material */}
        <div className="md:col-span-4 space-y-2">
          <Label>Material</Label>
          <Select
            value={filters.material}
            onValueChange={(v: FilterState["material"]) => setFilters(f => ({ ...f, material: v }))}
          >
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Direct Material">Direct Material</SelectItem>
              <SelectItem value="Indirect Material">Indirect Material</SelectItem>
              <SelectItem value="Unassigned">Unassigned</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Based on <span className="font-mono">master.category</span>. “Unassigned” will capture values other than the two above.
          </p>
        </div>
      </div>

      {/* Dev aid (remove later) */}
      <div className="rounded-xl border p-3 text-xs text-muted-foreground font-mono">
        {MONTHS.find(m => m.value === filters.month)?.label} {filters.year}
        {" • "}Dept: {filters.deptMode}{filters.deptMode === "list" && filters.deptSelected ? ` → ${filters.deptSelected}` : ""}
        {" • "}Material: {filters.material}
      </div>
    </div>
  );
}
