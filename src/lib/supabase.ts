import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type Sketch = {
  id: string; user_id: string; name: string; code: string; description: string;
  created_at: string; updated_at: string; last_compiled_at: string | null; last_flashed_at: string | null;
};

export type BoardSettings = {
  id: string; user_id: string; selected_board: string; sdk_version: string;
  psram_mode: string; flash_size: string; usb_cdc_enabled: boolean;
  partition_scheme: string; serial_baud_rate: number;
};

export async function getUserSketches() {
  const { data, error } = await supabase.from('sketches').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  return data as Sketch[];
}

export async function createSketch(name: string, code = '', description = '') {
  const { data, error } = await supabase.from('sketches').insert({ name, code, description }).select().single();
  if (error) throw error;
  return data as Sketch;
}

export async function updateSketch(id: string, updates: Partial<Sketch>) {
  const { data, error } = await supabase.from('sketches').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  return data as Sketch;
}

export async function deleteSketch(id: string) {
  const { error } = await supabase.from('sketches').delete().eq('id', id);
  if (error) throw error;
}

export async function saveBinary(binary: Record<string, unknown>) {
  const { data, error } = await supabase.from('compiled_binaries').insert(binary).select().single();
  if (error) throw error;
  return data;
}

export async function logFlash(flash: Record<string, unknown>) {
  const { data, error } = await supabase.from('flash_history').insert(flash).select().single();
  if (error) throw error;
  return data;
}

export async function getBoardSettings() {
  const { data, error } = await supabase.from('board_settings').select('*').maybeSingle();
  if (error) throw error;
  return data as BoardSettings | null;
}

export async function saveBoardSettings(settings: Partial<BoardSettings>) {
  const { data, error } = await supabase.from('board_settings').upsert(settings).select().single();
  if (error) throw error;
  return data as BoardSettings;
}
