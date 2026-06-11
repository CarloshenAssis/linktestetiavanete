
CREATE POLICY "public read materials files" ON storage.objects FOR SELECT
  USING (bucket_id = 'materials');

CREATE POLICY "admin upload materials" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'materials' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin update materials files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'materials' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin delete materials files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'materials' AND public.has_role(auth.uid(), 'admin'));
