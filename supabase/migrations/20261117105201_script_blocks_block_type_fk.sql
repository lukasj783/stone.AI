-- Universal Script Engine: block_type moves from a fixed enum to a foreign key
-- on script_block_types, so new block types are configuration, not schema changes.
-- This also allows 'parenthetical', which the editor already writes.
--
-- The old public.script_block_type enum is left in place, unused. Drop it
-- separately with: drop type public.script_block_type;

alter table public.script_blocks
  alter column block_type type text using block_type::text;

alter table public.script_blocks
  add constraint script_blocks_block_type_fkey
    foreign key (block_type) references public.script_block_types(key);
