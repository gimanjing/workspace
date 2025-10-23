# Master Table CRUD Application - TODO

## Overview
Create a web application to manage the "master" table in Supabase with full CRUD operations.

## Table Structure
- no_mat (material number)
- mat_name (material name)
- category
- qty (quantity)
- UoM (Unit of Measurement)
- Price

## Files to Create/Modify

1. **src/lib/supabase.ts** - Supabase client configuration
2. **src/types/master.ts** - TypeScript types for master table
3. **src/pages/Index.tsx** - Main page with data table and CRUD operations
4. **index.html** - Update title to "Master Data Management"

## Features to Implement
- Display all records in a data table
- Add new record (dialog form)
- Edit existing record (dialog form)
- Delete record (confirmation dialog)
- Real-time connection to Supabase
- Form validation
- Loading states
- Error handling
- Success notifications

## Implementation Plan
1. Set up Supabase client
2. Create TypeScript types
3. Build main page with table display
4. Implement Add functionality
5. Implement Edit functionality
6. Implement Delete functionality
7. Add proper error handling and notifications
8. Update page title