# Master Data Management Setup Guide

## Prerequisites
- A Supabase account and project
- Node.js and pnpm installed

## Setup Instructions

### 1. Configure Supabase

First, you need to create the `master` table in your Supabase database if you haven't already:

```sql
CREATE TABLE master (
  no_mat TEXT PRIMARY KEY,
  mat_name TEXT NOT NULL,
  category TEXT NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 0,
  UoM TEXT NOT NULL,
  Price NUMERIC NOT NULL DEFAULT 0
);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE master ENABLE ROW LEVEL SECURITY;

-- Create a policy to allow all operations (adjust based on your security needs)
CREATE POLICY "Allow all operations" ON master
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

### 2. Get Your Supabase Credentials

1. Go to your Supabase project dashboard
2. Navigate to Settings > API
3. Copy your **Project URL** and **anon/public key**

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit the `.env` file and add your Supabase credentials:

```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. Install Dependencies

```bash
pnpm install
```

### 5. Run the Application

```bash
pnpm run dev
```

The application will be available at `http://localhost:5173`

## Features

- **View Records**: All records from the master table are displayed in a table format
- **Add Record**: Click the "Add New Record" button to create a new entry
- **Edit Record**: Click the pencil icon on any row to edit that record
- **Delete Record**: Click the trash icon to delete a record (with confirmation)
- **Real-time Updates**: All changes are immediately reflected in the database

## Usage Tips

1. **Material Number** (no_mat) is the primary key and cannot be changed after creation
2. All fields are required when adding a new record
3. Quantity and Price accept decimal numbers
4. The table automatically refreshes after any CRUD operation
5. Success and error messages appear as toast notifications

## Troubleshooting

### Connection Issues
- Verify your Supabase URL and anon key are correct in the `.env` file
- Check that your Supabase project is active
- Ensure Row Level Security policies allow the operations you're trying to perform

### Table Not Found
- Make sure the `master` table exists in your Supabase database
- Verify the table name is exactly "master" (case-sensitive)

### Permission Errors
- Check your Row Level Security policies
- Ensure the anon key has the necessary permissions