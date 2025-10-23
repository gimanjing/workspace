import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { MasterRecord } from '@/types/master';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ThemeToggle } from '@/components/theme-toggle';
import { Navigation } from '@/components/navigation';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Loader2, AlertCircle } from 'lucide-react';

export default function Index() {
  const [records, setRecords] = useState<MasterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<MasterRecord | null>(null);
  const [formData, setFormData] = useState<MasterRecord>({
    no_mat: '',
    mat_name: '',
    category: '',
    qty: 0,
    UoM: '',
    Price: 0,
  });
  const [submitting, setSubmitting] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    checkConfiguration();
  }, []);

  const checkConfiguration = async () => {
    const hasUrl = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL !== 'https://placeholder.supabase.co';
    const hasKey = import.meta.env.VITE_SUPABASE_ANON_KEY && import.meta.env.VITE_SUPABASE_ANON_KEY !== 'placeholder-key';
    
    if (hasUrl && hasKey) {
      setIsConfigured(true);
      fetchRecords();
    } else {
      setIsConfigured(false);
      setLoading(false);
    }
  };

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('master')
        .select('*')
        .order('no_mat', { ascending: true });

      if (error) throw error;
      setRecords(data || []);
    } catch (error) {
      toast.error('Failed to fetch records: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    try {
      setSubmitting(true);
      const { error } = await supabase.from('master').insert([formData]);

      if (error) throw error;

      toast.success('Record added successfully');
      setIsAddDialogOpen(false);
      resetForm();
      fetchRecords();
    } catch (error) {
      toast.error('Failed to add record: ' + (error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedRecord) return;

    try {
      setSubmitting(true);
      const { error } = await supabase
        .from('master')
        .update(formData)
        .eq('no_mat', selectedRecord.no_mat);

      if (error) throw error;

      toast.success('Record updated successfully');
      setIsEditDialogOpen(false);
      resetForm();
      fetchRecords();
    } catch (error) {
      toast.error('Failed to update record: ' + (error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRecord) return;

    try {
      setSubmitting(true);
      const { error } = await supabase
        .from('master')
        .delete()
        .eq('no_mat', selectedRecord.no_mat);

      if (error) throw error;

      toast.success('Record deleted successfully');
      setIsDeleteDialogOpen(false);
      setSelectedRecord(null);
      fetchRecords();
    } catch (error) {
      toast.error('Failed to delete record: ' + (error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const openAddDialog = () => {
    resetForm();
    setIsAddDialogOpen(true);
  };

  const openEditDialog = (record: MasterRecord) => {
    setSelectedRecord(record);
    setFormData(record);
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (record: MasterRecord) => {
    setSelectedRecord(record);
    setIsDeleteDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      no_mat: '',
      mat_name: '',
      category: '',
      qty: 0,
      UoM: '',
      Price: 0,
    });
    setSelectedRecord(null);
  };

  const handleInputChange = (field: keyof MasterRecord, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  if (!isConfigured) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
          <div className="max-w-4xl mx-auto">
            <div className="flex justify-end mb-4">
              <ThemeToggle />
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-8">
              <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <AlertTitle className="text-amber-900 dark:text-amber-100 font-semibold text-lg">Supabase Configuration Required</AlertTitle>
                <AlertDescription className="text-amber-800 dark:text-amber-200 mt-2 space-y-4">
                  <p>To use this Master Data Management application, you need to configure your Supabase credentials.</p>
                  
                  <div className="bg-white dark:bg-slate-900 rounded-md p-4 border border-amber-200 dark:border-amber-800 mt-4">
                    <p className="font-semibold mb-2">Quick Setup Steps:</p>
                    <ol className="list-decimal list-inside space-y-2 text-sm">
                      <li>Click the <strong>Supabase</strong> button at the top-right corner of the MGX platform</li>
                      <li>Enter your Supabase Project URL and anon key</li>
                      <li>Make sure you have created the "master" table in your Supabase database</li>
                      <li>Refresh this page after configuration</li>
                    </ol>
                  </div>

                  <div className="bg-white dark:bg-slate-900 rounded-md p-4 border border-amber-200 dark:border-amber-800 mt-4">
                    <p className="font-semibold mb-2">Create the Master Table:</p>
                    <p className="text-sm mb-2">Run this SQL in your Supabase SQL Editor:</p>
                    <pre className="bg-slate-900 dark:bg-slate-950 text-slate-100 p-3 rounded text-xs overflow-x-auto">
{`CREATE TABLE master (
  no_mat TEXT PRIMARY KEY,
  mat_name TEXT NOT NULL,
  category TEXT NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 0,
  UoM TEXT NOT NULL,
  Price NUMERIC NOT NULL DEFAULT 0
);

ALTER TABLE master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations" ON master
  FOR ALL USING (true) WITH CHECK (true);`}
                    </pre>
                  </div>

                  <p className="text-sm mt-4">
                    For detailed instructions, check the <code className="bg-amber-100 dark:bg-amber-900 px-2 py-1 rounded">SETUP.md</code> file in the project.
                  </p>
                </AlertDescription>
              </Alert>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100">Master Data Management</h1>
                <p className="text-slate-600 dark:text-slate-400 mt-1">Manage your inventory master data</p>
              </div>
              <div className="flex gap-2">
                <ThemeToggle />
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={openAddDialog} className="gap-2">
                      <Plus className="h-4 w-4" />
                      Add New Record
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                      <DialogTitle>Add New Record</DialogTitle>
                      <DialogDescription>
                        Fill in the details to add a new master record.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
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
                        <Label htmlFor="mat_name">Material Name</Label>
                        <Input
                          id="mat_name"
                          value={formData.mat_name}
                          onChange={(e) => handleInputChange('mat_name', e.target.value)}
                          placeholder="Enter material name"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="category">Category</Label>
                        <Input
                          id="category"
                          value={formData.category}
                          onChange={(e) => handleInputChange('category', e.target.value)}
                          placeholder="Enter category"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="qty">Quantity</Label>
                          <Input
                            id="qty"
                            type="number"
                            value={formData.qty}
                            onChange={(e) => handleInputChange('qty', parseFloat(e.target.value) || 0)}
                            placeholder="0"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="UoM">Unit of Measurement</Label>
                          <Input
                            id="UoM"
                            value={formData.UoM}
                            onChange={(e) => handleInputChange('UoM', e.target.value)}
                            placeholder="e.g., kg, pcs"
                          />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="Price">Price (Rp)</Label>
                        <Input
                          id="Price"
                          type="number"
                          step="1"
                          value={formData.Price}
                          onChange={(e) => handleInputChange('Price', parseFloat(e.target.value) || 0)}
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setIsAddDialogOpen(false)}
                        disabled={submitting}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleAdd} disabled={submitting}>
                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Add Record
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-slate-600 dark:text-slate-400" />
              </div>
            ) : records.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-600 dark:text-slate-400 text-lg">No records found. Add your first record to get started.</p>
              </div>
            ) : (
              <div className="border dark:border-slate-700 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-900">
                      <TableHead className="font-semibold">Material No.</TableHead>
                      <TableHead className="font-semibold">Material Name</TableHead>
                      <TableHead className="font-semibold">Category</TableHead>
                      <TableHead className="font-semibold text-right">Quantity</TableHead>
                      <TableHead className="font-semibold">UoM</TableHead>
                      <TableHead className="font-semibold text-right">Price</TableHead>
                      <TableHead className="font-semibold text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((record) => (
                      <TableRow key={record.no_mat} className="hover:bg-slate-50 dark:hover:bg-slate-900">
                        <TableCell className="font-medium">{record.no_mat}</TableCell>
                        <TableCell>{record.mat_name}</TableCell>
                        <TableCell>{record.category}</TableCell>
                        <TableCell className="text-right">{record.qty}</TableCell>
                        <TableCell>{record.UoM}</TableCell>
                        <TableCell className="text-right">{formatPrice(record.Price)}</TableCell>
                        <TableCell>
                          <div className="flex justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(record)}
                              className="hover:bg-blue-50 dark:hover:bg-blue-950 hover:text-blue-600 dark:hover:text-blue-400"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openDeleteDialog(record)}
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

        {/* Edit Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Edit Record</DialogTitle>
              <DialogDescription>
                Update the details of the master record.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit_no_mat">Material Number</Label>
                <Input
                  id="edit_no_mat"
                  value={formData.no_mat}
                  disabled
                  className="bg-slate-50 dark:bg-slate-900"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_mat_name">Material Name</Label>
                <Input
                  id="edit_mat_name"
                  value={formData.mat_name}
                  onChange={(e) => handleInputChange('mat_name', e.target.value)}
                  placeholder="Enter material name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_category">Category</Label>
                <Input
                  id="edit_category"
                  value={formData.category}
                  onChange={(e) => handleInputChange('category', e.target.value)}
                  placeholder="Enter category"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit_qty">Quantity</Label>
                  <Input
                    id="edit_qty"
                    type="number"
                    value={formData.qty}
                    onChange={(e) => handleInputChange('qty', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit_UoM">Unit of Measurement</Label>
                  <Input
                    id="edit_UoM"
                    value={formData.UoM}
                    onChange={(e) => handleInputChange('UoM', e.target.value)}
                    placeholder="e.g., kg, pcs"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_Price">Price (Rp)</Label>
                <Input
                  id="edit_Price"
                  type="number"
                  step="1"
                  value={formData.Price}
                  onChange={(e) => handleInputChange('Price', parseFloat(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsEditDialogOpen(false)}
                disabled={submitting}
              >
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
                This action cannot be undone. This will permanently delete the record for{' '}
                <span className="font-semibold">{selectedRecord?.mat_name}</span> (
                {selectedRecord?.no_mat}).
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
      </div>
    </>
  );
}