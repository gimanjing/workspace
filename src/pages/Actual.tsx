"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

/* Navigation & Layout */
import { SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger } from "@/components/ui/sidebar";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";

/* Page chrome */
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { toast } from "sonner";

/* Table */
import {
  Table, TableHeader, TableHead, TableRow, TableBody, TableCell
} from "@/components/ui/table";

/* Optional icons (lucide-react) */
import { Upload, Trash2, RefreshCw, Database, FileSpreadsheet, ArrowRightLeft } from "lucide-react";

/* ---------- Types ---------- */
type ActualRow = {
  no_mat: string;
  dept: string | null;
  quantity: number | null;
  posting_date: string;
  document_date: string;
};

type MasterRow = {
  no_mat: string;
  mat_name: string;
  category: string;
  qty: number | null;
  Price: number | null;
  UoM: string;
  created_at?: string;
  updated_at?: string;
};

/* ---------- Helpers (unchanged logic) ---------- */
function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function excelSerialToYmd(n: number) {
  const ms = (n - 25569) * 86400000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toYmd(v: string | number | null | undefined) {
  if (v == null) return "";
  if (typeof v === "number") return excelSerialToYmd(v);
  const s = String(v).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const d2 = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${mo}-${d2}`;
  }
  return s;
}

async function parseExcel(file: File): Promise<{ headers: string[]; rows: any[][] }> {
  const XLSX = await import("xlsx"); // cosmetic refactor: local module
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const wsName = wb.SheetNames[0];
  if (!wsName) return { headers: [], rows: [] };
  const ws = wb.Sheets[wsName];
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  if (!aoa || aoa.length === 0) return { headers: [], rows: [] };
  const headers = (aoa[0] ?? []).map((h: any) => String(h ?? "").trim());
  const rows = aoa.slice(1);
  return { headers, rows };
}

function chunk<T>(arr: T[], size = 500) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function nextMonthStart(dateYmd: string) {
  const [y, m] = dateYmd.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/* ---------- Page ---------- */
export default function Actual() {
  const [_now] = useState(useMemo(() => new Date(), []));
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [preview, setPreview] = useState<ActualRow[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshMissingList();
  }, []);

  function mapHeaders(headers: string[]) {
    const idx: Record<"material" | "cost center" | "total quantity" | "posting date" | "document date", number> = {
      "material": -1,
      "cost center": -1,
      "total quantity": -1,
      "posting date": -1,
      "document date": -1,
    };
    headers.forEach((h, i) => {
      const n = normalizeHeader(h);
      if (n === "material") idx["material"] = i;
      else if (n === "cost center") idx["cost center"] = i;
      else if (n === "total quantity") idx["total quantity"] = i;
      else if (n === "posting date") idx["posting date"] = i;
      else if (n === "document date") idx["document date"] = i;
    });
    return idx;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview([]);
    if (!f) return;

    try {
      const { headers, rows } = await parseExcel(f);
      if (headers.length === 0) throw new Error("No header row found");
      const idx = mapHeaders(headers);

      const required = ["material", "cost center", "total quantity", "posting date", "document date"] as const;
      const missingHdr = required.filter((k) => idx[k] === -1);
      if (missingHdr.length) throw new Error(`Missing columns: ${missingHdr.join(", ")}`);

      const out: ActualRow[] = [];
      for (const r of rows) {
        if (!r || r.length === 0) continue;
        const material = String(r[idx["material"]] ?? "").trim();
        const dept = String(r[idx["cost center"]] ?? "").trim();
        const qtyRaw = r[idx["total quantity"]];
        const postingRaw = r[idx["posting date"]];
        const docRaw = r[idx["document date"]];
        if (!material) continue;

        const qtmp = String(qtyRaw ?? "").replace(/,/g, "").trim();
        const quantity = qtmp ? Number(qtmp) : null;
        const posting_date = toYmd(postingRaw);
        const document_date = toYmd(docRaw);

        out.push({ no_mat: material, dept: dept || null, quantity, posting_date, document_date });
      }

      toast.success(`Loaded ${out.length} rows from ${f.name}`);
      setPreview(out);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Failed to read Excel");
    }
  }

  async function importNow() {
    if (!preview.length) {
      toast.error("No prepared rows to import.");
      return;
    }
    setBusy(true);
    try {
      const months = new Set<string>();
      for (const r of preview) {
        const base = r.posting_date || r.document_date;
        if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(base)) continue;
        months.add(base.slice(0, 7));
      }

      for (const ym of months) {
        const start = `${ym}-01`;
        const next = nextMonthStart(start);
        const { error: delErr } = await supabase
          .from("actual")
          .delete()
          .gte("posting_date", start)
          .lt("posting_date", next);
        if (delErr) throw new Error(`Purge ${ym} failed: ${delErr.message}`);
      }

      for (const group of chunk(preview, 500)) {
        const { error } = await supabase.from("actual").insert(group);
        if (error) throw new Error(`Insert failed: ${error.message}`);
      }

      await refreshMissingList();
      toast.success(`Imported ${preview.length} rows & refreshed missing list`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function addToMaster(payload: MasterRow) {
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from("master").insert({
        no_mat: payload.no_mat,
        mat_name: payload.mat_name,
        category: payload.category,
        qty: payload.qty,
        Price: payload.Price,
        UoM: payload.UoM,
        created_at: now,
        updated_at: now,
      });
      if (error) throw new Error(error.message);
      setMissing((prev) => prev.filter((m) => m !== payload.no_mat));
      toast.success(`Added ${payload.no_mat} to master`);
    } catch (e: any) {
      toast.error(e?.message ?? "Insert failed");
    }
  }

  async function refreshMissingList() {
    try {
      const { data: actualData, error: err1 } = await supabase.from("actual").select("no_mat");
      if (err1) throw err1;
      const { data: masterData, error: err2 } = await supabase.from("master").select("no_mat");
      if (err2) throw err2;

      const masterSet = new Set((masterData ?? []).map((m) => m.no_mat));
      const missingList = Array.from(new Set((actualData ?? []).map((a) => a.no_mat))).filter(
        (x) => !masterSet.has(x)
      );

      setMissing(missingList);
      toast.success(`Missing list refreshed — ${missingList.length} item(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to refresh list");
    }
  }

  return (
    <SidebarProvider>
      <div className="min-h-dvh grid grid-cols-[260px_1fr] bg-background">
        {/* Sidebar */}
        <aside className="border-r bg-card sticky top-0 h-dvh">
          <Sidebar>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Data</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <a className="truncate">Actual Import</a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <a className="truncate">Master</a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
        </aside>

        {/* Main */}
        <main className="min-w-0">
          <div className="px-8 py-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink href="#">Data</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>Actual Import</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
                <div className="mt-2">
                  <h1 className="text-2xl font-semibold tracking-tight">Actual — Upload & Import</h1>
                  <p className="text-sm text-muted-foreground">
                    Prepare rows from Excel, purge the affected month(s), and import in batches.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm" onClick={refreshMissingList}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh Missing
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Rebuild the missing list from current data</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <SidebarTrigger />
              </div>
            </div>

            <Separator className="my-6" />

            {/* Uploader + Actions */}
            <Card className="border-dashed">
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Upload Excel</CardTitle>
                <CardDescription>Accepts .xlsx / .xls. First sheet is used.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className="rounded-lg border-2 border-dashed p-6 bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="file" className="text-sm">Excel file</Label>
                      <Input
                        key={fileKey}
                        id="file"
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleFile}
                        className="w-80"
                      />
                      {file && (
                        <div className="text-xs text-muted-foreground">
                          Selected: <span className="font-medium">{file.name}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => { setFile(null); setPreview([]); setFileKey(k => k + 1); }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Clear
                      </Button>
                      <Button onClick={importNow} disabled={!preview.length || busy}>
                        {busy ? (
                          <>
                            <ArrowRightLeft className="h-4 w-4 mr-2 animate-spin" />
                            Importing…
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4 mr-2" />
                            Purge month(s) & Import
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Progress value={preview.length ? 100 : 0} className="h-1.5" />
                    <div className="mt-2 text-xs text-muted-foreground">
                      {preview.length ? `Prepared ${preview.length} row(s)` : "No rows prepared"}
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="text-xs text-muted-foreground">
                <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />
                Ensure the header row contains Material, Cost Center, Total Quantity, Posting Date, Document Date.
              </CardFooter>
            </Card>

            {/* Workspace */}
            <div className="mt-6">
              <ResizablePanelGroup direction="horizontal" className="rounded-lg border">
                <ResizablePanel defaultSize={55} minSize={35}>
                  <div className="h-[62vh] flex flex-col">
                    <div className="px-4 py-3 border-b flex items-center justify-between bg-muted/30">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">Preview</CardTitle>
                        <Badge variant="secondary">{preview.length}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">Showing first 20 rows</span>
                    </div>

                    <ScrollArea className="flex-1">
                      <div className="p-4 pt-2">
                        <div className="rounded-md border overflow-hidden">
                          <Table className="[&_th]:bg-muted/40">
                            <TableHeader className="sticky top-0 z-10">
                              <TableRow>
                                <TableHead className="min-w-[140px]">no_mat</TableHead>
                                <TableHead className="min-w-[120px]">dept</TableHead>
                                <TableHead className="text-right min-w-[100px]">quantity</TableHead>
                                <TableHead className="min-w-[120px]">posting_date</TableHead>
                                <TableHead className="min-w-[120px]">document_date</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {preview.slice(0, 20).map((r, i) => (
                                <TableRow key={i} className="even:bg-muted/20">
                                  <TableCell className="font-mono">{r.no_mat}</TableCell>
                                  <TableCell>{r.dept ?? ""}</TableCell>
                                  <TableCell className="text-right tabular-nums">{r.quantity ?? ""}</TableCell>
                                  <TableCell className="tabular-nums">{r.posting_date}</TableCell>
                                  <TableCell className="tabular-nums">{r.document_date}</TableCell>
                                </TableRow>
                              ))}
                              {preview.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                                    No preview. Upload a file to see parsed rows.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </ScrollArea>
                  </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                <ResizablePanel defaultSize={45} minSize={30}>
                  <div className="h-[62vh] flex flex-col">
                    <div className="px-4 py-3 border-b flex items-center justify-between bg-muted/30">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">Materials missing in master</CardTitle>
                        <Badge variant="outline">{missing.length}</Badge>
                      </div>
                      <Button size="sm" variant="outline" onClick={refreshMissingList}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                      </Button>
                    </div>

                    <ScrollArea className="flex-1">
                      <div className="p-4 pt-2">
                        <div className="rounded-md border overflow-hidden">
                          <Table className="[&_th]:bg-muted/40">
                            <TableHeader className="sticky top-0 z-10">
                              <TableRow>
                                <TableHead className="w-40">no_mat</TableHead>
                                <TableHead className="w-64">mat_name</TableHead>
                                <TableHead className="w-48">category</TableHead>
                                <TableHead className="text-right w-24">qty</TableHead>
                                <TableHead className="text-right w-28">Price</TableHead>
                                <TableHead className="w-24">UoM</TableHead>
                                <TableHead className="text-center w-32">Action</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {missing.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                                    No missing items. Import or refresh data first.
                                  </TableCell>
                                </TableRow>
                              ) : (
                                missing.map((no_mat) => (
                                  <MissingRow key={no_mat} no_mat={no_mat} onAdd={addToMaster} />
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </ScrollArea>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

/* ---------- MissingRow Component (cosmetic pass) ---------- */
function MissingRow({
  no_mat,
  onAdd,
}: {
  no_mat: string;
  onAdd: (payload: MasterRow) => Promise<void>;
}) {
  const [mat_name, setMatName] = useState("");
  const [category, setCategory] = useState("");
  const [qty, setQty] = useState<number | null>(null);
  const [Price, setPrice] = useState<number | null>(null);
  const [UoM, setUoM] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <TableRow className="even:bg-muted/20">
      <TableCell className="font-mono">{no_mat}</TableCell>
      <TableCell>
        <Input value={mat_name} onChange={(e) => setMatName(e.target.value)} placeholder="mat_name" />
      </TableCell>
      <TableCell>
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="category" />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          value={qty ?? ""}
          onChange={(e) => setQty(e.target.value ? Number(e.target.value) : null)}
          placeholder="qty"
          className="w-24 text-right"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          value={Price ?? ""}
          onChange={(e) => setPrice(e.target.value ? Number(e.target.value) : null)}
          placeholder="Price"
          className="w-28 text-right"
        />
      </TableCell>
      <TableCell>
        <Input value={UoM} onChange={(e) => setUoM(e.target.value)} placeholder="UoM" className="w-24" />
      </TableCell>
      <TableCell className="text-center">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd({ no_mat, mat_name, category, qty, Price, UoM });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : "Add"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
