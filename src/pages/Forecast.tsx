// app/forecast/page.tsx
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ThemeToggle } from '@/components/theme-toggle';
import { Navigation } from '@/components/navigation';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Loader2, Upload, Trash } from 'lucide-react';

// ---- Types -----------------------------------------------------------------
type ForecastRow = {
  id: string;
  no_mat: string;
  shop: string;
  usage: number;
  month: string; // 'YYYY-MM-01'
};
type ForecastWritable = Omit<ForecastRow, 'id'>;

// ---- Utils -----------------------------------------------------------------
function stripGeneratedCols<T extends Record<string, unknown>>(obj: T) {
  const clone = { ...obj };
  delete (clone as Record<string, unknown>).month_label;
  return clone as T;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const monthStartISO = (y: number, m: number) => `${String(y)}-${pad2(m)}-01`;

const parseISO = (iso?: string) => {
  // '2025-04-01' -> { y: 2025, m: 4 }  (fallback: now)
  const now = new Date();
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { y: now.getFullYear(), m: now.getMonth() + 1 };
  }
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return { y: Number.isFinite(y) ? y : now.getFullYear(), m: Number.isFinite(m) ? m : (now.getMonth() + 1) };
};

// ---- MonthPicker (cross-browser, Shadcn Selects) ---------------------------
function MonthPicker({
  id,
  value,                 // 'YYYY-MM-01' or ''
  onChange,
  yearRange = 2,         // years before/after current
  labelSrOnly = false,
  label = 'Month',
}: {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  yearRange?: number;
  labelSrOnly?: boolean;
  label?: string;
}) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = currentYear - yearRange; y <= currentYear + yearRange; y++) arr.push(y);
    return arr;
  }, [currentYear, yearRange]);

  const months = [
    { v: '01', n: 'Jan' }, { v: '02', n: 'Feb' }, { v: '03', n: 'Mar' }, { v: '04', n: 'Apr' },
    { v: '05', n: 'May' }, { v: '06', n: 'Jun' }, { v: '07', n: 'Jul' }, { v: '08', n: 'Aug' },
    { v: '09', n: 'Sep' }, { v: '10', n: 'Oct' }, { v: '11', n: 'Nov' }, { v: '12', n: 'Dec' },
  ];

  const { y, m } = parseISO(value);
  const monthStr = pad2(m);

  const handleYear = (newYearStr: string) => {
    const ny = Number(newYearStr);
    onChange(monthStartISO(ny, m));
  };
  const handleMonth = (newMonthStr: string) => {
    const nm = Number(newMonthStr);
    onChange(monthStartISO(y, nm));
  };

  return (
    <div className="grid gap-2">
      {!labelSrOnly && <Label htmlFor={id}>{label}</Label>}
      <div className="flex gap-2">
        <Select value={String(y)} onValueChange={handleYear}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {years.map((yr) => (
              <SelectItem key={yr} value={String(yr)}>{yr}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={monthStr} onValueChange={handleMonth}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {months.map((mm) => (
              <SelectItem key={mm.v} value={mm.v}>{mm.n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-slate-500">Saved as {monthStartISO(y, m)}</p>
    </div>
  );
}

// ---- Page ------------------------------------------------------------------
export default function Forecast() {
  const [records, setRecords] = useState<ForecastRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedMonth, setSelectedMonth] = useState<string>(''); // 'YYYY-MM-01'
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isPurgeDialogOpen, setIsPurgeDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  const [selectedRecord, setSelectedRecord] = useState<ForecastRow | null>(null);
  const [formData, setFormData] = useState<ForecastWritable>({
    no_mat: '',
    shop: '',
    usage: 0,
    month: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Default selectedMonth to current month
  useEffect(() => {
    if (!selectedMonth) {
      const now = new Date();
      setSelectedMonth(monthStartISO(now.getFullYear(), now.getMonth() + 1));
    }
  }, [selectedMonth]);

  // Load months on mount
  useEffect(() => { fetchAvailableMonths(); }, []);
  // Load rows when month changes
  useEffect(() => { if (selectedMonth) fetchRecords(); }, [selectedMonth]);

  // -------------------- Data fetchers --------------------
  const fetchAvailableMonths = async () => {
    try {
      const { data, error } = await supabase
        .from('forecast')
        .select('month')
        .order('month', { ascending: false });

      if (error) throw error;
      const unique = Array.from(new Set((data ?? []).map((d: { month: string }) => String(d.month))));
      setAvailableMonths(unique);
    } catch (err) {
      toast.error('Failed to fetch available months: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('forecast')
        .select('id,no_mat,shop,usage,month')
        .eq('month', selectedMonth)
        .order('id', { ascending: true });

      if (error) throw error;
      setRecords((data ?? []) as ForecastRow[]);
    } catch (err) {
      toast.error('Failed to fetch records: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // -------------------- CRUD --------------------
  const handleAdd = async () => {
    try {
      setSubmitting(true);
      const monthISO = formData.month || selectedMonth;
      if (!monthISO) {
        toast.error('Please choose a month.');
        return;
      }
      const payload = stripGeneratedCols({
        no_mat: formData.no_mat,
        shop: formData.shop,
        usage: formData.usage,
        month: monthISO,
      });

      const { error } = await supabase.from('forecast').insert([payload]);
      if (error) throw error;

      toast.success('Record added');
      setIsAddDialogOpen(false);
      resetForm();
      if (monthISO !== selectedMonth) setSelectedMonth(monthISO);
      fetchRecords();
      fetchAvailableMonths();
    } catch (err) {
      toast.error('Failed to add record: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedRecord) return;
    try {
      setSubmitting(true);
      const patch = stripGeneratedCols({
        no_mat: formData.no_mat,
        shop: formData.shop,
        usage: formData.usage,
        month: formData.month || selectedRecord.month,
      });

      const { error } = await supabase.from('forecast').update(patch).eq('id', selectedRecord.id);
      if (error) throw error;

      toast.success('Record updated');
      setIsEditDialogOpen(false);
      const changedMonth = patch.month as string;
      resetForm();
      if (changedMonth && changedMonth !== selectedMonth) setSelectedMonth(changedMonth);
      fetchRecords();
      fetchAvailableMonths();
    } catch (err) {
      toast.error('Failed to update record: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRecord) return;
    try {
      setSubmitting(true);
      const { error } = await supabase.from('forecast').delete().eq('id', selectedRecord.id);
      if (error) throw error;

      toast.success('Record deleted');
      setIsDeleteDialogOpen(false);
      setSelectedRecord(null);
      fetchRecords();
    } catch (err) {
      toast.error('Failed to delete record: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePurge = async () => {
    if (!selectedMonth) return;
    try {
      setSubmitting(true);
      const { error } = await supabase.from('forecast').delete().eq('month', selectedMonth);
      if (error) throw error;

      toast.success(`All records for ${selectedMonth} deleted`);
      setIsPurgeDialogOpen(false);
      setRecords([]);
      fetchAvailableMonths();
    } catch (err) {
      toast.error('Failed to purge records: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkUpload = async () => {
  if (!uploadFile) return;
  try {
    setSubmitting(true);

    const monthISO = formData.month || selectedMonth;
    if (!monthISO) {
      toast.error('Pick a month first.');
      return;
    }

    // 1) Read text & normalize line breaks
    const raw = await uploadFile.text();
    const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.error('CSV is empty');
      return;
    }

    // 2) Detect delimiter from first non-empty line
    const candidates = [',', ';', '\t', '|'];
    const sampleLine = lines[0];
    let delimiter = ',';
    let maxParts = 0;
    for (const d of candidates) {
      const parts = sampleLine.split(d).length;
      if (parts > maxParts) { maxParts = parts; delimiter = d; }
    }

    // 3) Header detection (case-insensitive, trims)
    const headerCells = sampleLine.split(delimiter).map(c => c.trim().toLowerCase());
    const looksLikeHeader =
      headerCells.includes('no_mat') || headerCells.includes('shop') || headerCells.includes('usage');

    // 4) Resolve column indices
    let startIdx = 0;
    let idxNoMat = 0, idxShop = 1, idxUsage = 2;

    if (looksLikeHeader) {
      startIdx = 1;
      idxNoMat = Math.max(headerCells.indexOf('no_mat'), 0);
      idxShop  = headerCells.indexOf('shop')  >= 0 ? headerCells.indexOf('shop')  : 1;
      idxUsage = headerCells.indexOf('usage') >= 0 ? headerCells.indexOf('usage') : 2;
    } else {
      // No header → assume first 3 columns are no_mat, shop, usage
      if (sampleLine.split(delimiter).length < 3) {
        toast.error(`Expected at least 3 columns per line (found delimiter "${delimiter}").`);
        return;
      }
    }

    // 5) Build batch
    const batch: ForecastWritable[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      const row = lines[i].split(delimiter).map(c => c.trim());
      if (row.length === 0) continue;

      const no_mat = (row[idxNoMat] ?? '').trim();
      const shop   = (row[idxShop]  ?? '').trim();
      const usageStr = (row[idxUsage] ?? '').trim();

      if (!no_mat || !shop) continue; // skip invalid rows

      // allow empty usage as 0
      const usage = usageStr === '' ? 0 : Number(usageStr.replace(/,/g, ''));
      if (!Number.isFinite(usage)) {
        // skip rows with non-numeric usage
        continue;
      }

      batch.push({ no_mat, shop, usage, month: monthISO });
    }

    if (batch.length === 0) {
      toast.error('No valid records found. Check delimiter (comma/semicolon/tab) and columns (no_mat, shop, usage).');
      return;
    }

    const { error } = await supabase.from('forecast').insert(batch);
    if (error) throw error;

    toast.success(`Uploaded ${batch.length} records for ${monthISO}`);
    setIsUploadDialogOpen(false);
    setUploadFile(null);
    if (monthISO !== selectedMonth) setSelectedMonth(monthISO);
    fetchRecords();
    fetchAvailableMonths();
  } catch (err) {
    toast.error('Failed to upload records: ' + (err as Error).message);
  } finally {
    setSubmitting(false);
  }
};

  // -------------------- Dialog helpers --------------------
  const openAddDialog = () => {
    resetForm();
    if (selectedMonth) setFormData((p) => ({ ...p, month: selectedMonth }));
    setIsAddDialogOpen(true);
  };

  const openEditDialog = (r: ForecastRow) => {
    setSelectedRecord(r);
    setFormData({
      no_mat: r.no_mat,
      shop: r.shop,
      usage: r.usage,
      month: r.month,
    });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (r: ForecastRow) => { setSelectedRecord(r); setIsDeleteDialogOpen(true); };

  const resetForm = () => {
    setFormData({ no_mat: '', shop: '', usage: 0, month: '' });
    setSelectedRecord(null);
  };

  const handleInputChange = (field: keyof ForecastWritable, value: string | number) =>
    setFormData((prev) => ({ ...prev, [field]: value } as ForecastWritable));

  // -------------------- UI --------------------
  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h1 className="text-3xl font-bold">Forecast Management</h1>
                <p className="text-slate-600 dark:text-slate-400 mt-1">Manage forecast data by month</p>
              </div>
              <ThemeToggle />
            </div>

            <div className="flex gap-4 mb-6 flex-wrap items-end">
              <div className="flex-1 min-w-[300px]">
                <MonthPicker
                  id="month-filter"
                  label="Filter by Month"
                  value={selectedMonth}
                  onChange={setSelectedMonth}
                  yearRange={5}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Known months in DB: {availableMonths.length || 0}
                </p>
              </div>

              <Button onClick={openAddDialog} className="gap-2">
                <Plus className="h-4 w-4" />
                Add Record
              </Button>

              <Button onClick={() => setIsUploadDialogOpen(true)} variant="outline" className="gap-2">
                <Upload className="h-4 w-4" />
                Bulk Upload
              </Button>

              <Button
                onClick={() => setIsPurgeDialogOpen(true)}
                variant="destructive"
                className="gap-2"
                disabled={!selectedMonth || records.length === 0}
              >
                <Trash className="h-4 w-4" />
                Purge Month
              </Button>
            </div>

            {loading ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : !selectedMonth ? (
              <div className="text-center py-12">
                <p>Please select a month to view records.</p>
              </div>
            ) : records.length === 0 ? (
              <div className="text-center py-12">
                <p>No records found for {selectedMonth}.</p>
              </div>
            ) : (
              <div className="border dark:border-slate-700 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-900">
                      <TableHead className="font-semibold">ID</TableHead>
                      <TableHead className="font-semibold">Material No.</TableHead>
                      <TableHead className="font-semibold">Shop</TableHead>
                      <TableHead className="font-semibold text-right">Usage</TableHead>
                      <TableHead className="font-semibold">Month</TableHead>
                      <TableHead className="font-semibold text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((r) => (
                      <TableRow key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900">
                        <TableCell className="font-medium">{r.id}</TableCell>
                        <TableCell>{r.no_mat}</TableCell>
                        <TableCell>{r.shop}</TableCell>
                        <TableCell className="text-right">{r.usage}</TableCell>
                        <TableCell>{r.month}</TableCell>
                        <TableCell>
                          <div className="flex justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(r)}
                              className="hover:bg-blue-50 dark:hover:bg-blue-950 hover:text-blue-600 dark:hover:text-blue-400"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openDeleteDialog(r)}
                              className="hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        {/* Add Dialog */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Add New Record</DialogTitle>
              <DialogDescription>Choose a month and enter details.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <MonthPicker
                id="add_month"
                value={formData.month || selectedMonth}
                onChange={(iso) => handleInputChange('month', iso)}
                label="Month"
                yearRange={5}
              />
              <div className="grid gap-2">
                <Label htmlFor="no_mat">Material Number</Label>
                <Input
                  id="no_mat"
                  value={formData.no_mat}
                  onChange={(e) => handleInputChange('no_mat', e.target.value)}
                  placeholder="Enter material number"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="shop">Shop</Label>
                <Input
                  id="shop"
                  value={formData.shop}
                  onChange={(e) => handleInputChange('shop', e.target.value)}
                  placeholder="Enter shop name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="usage">Usage</Label>
                <Input
                  id="usage"
                  type="number"
                  value={formData.usage}
                  onChange={(e) => handleInputChange('usage', parseFloat(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleAdd} disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Record
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Edit Record</DialogTitle>
              <DialogDescription>Update details, including month.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <MonthPicker
                id="edit_month"
                value={formData.month}
                onChange={(iso) => handleInputChange('month', iso)}
                label="Month"
                yearRange={5}
              />
              <div className="grid gap-2">
                <Label htmlFor="edit_no_mat">Material Number</Label>
                <Input
                  id="edit_no_mat"
                  value={formData.no_mat}
                  onChange={(e) => handleInputChange('no_mat', e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_shop">Shop</Label>
                <Input
                  id="edit_shop"
                  value={formData.shop}
                  onChange={(e) => handleInputChange('shop', e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_usage">Usage</Label>
                <Input
                  id="edit_usage"
                  type="number"
                  value={formData.usage}
                  onChange={(e) => handleInputChange('usage', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleEdit} disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update Record
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the record for{' '}
                <span className="font-semibold">{selectedRecord?.no_mat}</span> at{' '}
                <span className="font-semibold">{selectedRecord?.shop}</span>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={submitting}
                className="bg-red-600 hover:bg-red-700 dark:bg-red-900 dark:hover:bg-red-800"
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Purge Confirmation Dialog */}
        <AlertDialog open={isPurgeDialogOpen} onOpenChange={setIsPurgeDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Purge All Records for {selectedMonth}?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete ALL {records.length} records for{' '}
                <span className="font-semibold">{selectedMonth}</span>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handlePurge}
                disabled={submitting}
                className="bg-red-600 hover:bg-red-700 dark:bg-red-900 dark:hover:bg-red-800"
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Purge All
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk Upload Dialog */}
        <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Bulk Upload</DialogTitle>
              <DialogDescription>
                Choose a month, then upload CSV (no_mat, shop, usage).
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <MonthPicker
                id="bulk_month"
                value={formData.month || selectedMonth}
                onChange={(iso) => handleInputChange('month', iso)}
                label="Month"
                yearRange={5}
              />
              <div className="grid gap-2">
                <Label htmlFor="csv-file">CSV File</Label>
                <Input
                  id="csv-file"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  CSV format: <code>no_mat, shop, usage</code>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Example: <code>MAT001, Shop A, 100</code>
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setIsUploadDialogOpen(false); setUploadFile(null); }}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={handleBulkUpload} disabled={submitting || !uploadFile}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Upload
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}