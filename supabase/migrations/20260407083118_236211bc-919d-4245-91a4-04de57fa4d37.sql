-- Storage policies for call_recordings bucket (public POC)
CREATE POLICY "Public read call_recordings"
ON storage.objects FOR SELECT
USING (bucket_id = 'call_recordings');

CREATE POLICY "Public insert call_recordings"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'call_recordings');

CREATE POLICY "Public update call_recordings"
ON storage.objects FOR UPDATE
USING (bucket_id = 'call_recordings');

CREATE POLICY "Public delete call_recordings"
ON storage.objects FOR DELETE
USING (bucket_id = 'call_recordings');
