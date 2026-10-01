-- ============================================================================
-- CICK Enterprise — Row Level Security: Student Policies (Placeholder)
-- ============================================================================
-- Students can view their own records: enrollment, attendance, exam results,
-- invoices, and notifications.
-- These are scaffold policies — refine before production deployment.
-- ============================================================================

-- Example:
-- create policy "student_view_own_results" on public.exam_results
--   for select
--   using (student_id = auth.uid());

-- TODO: Implement student policies for self-service tables.
