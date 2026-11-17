-- Universal Script Engine: characters can be presenters, narrators, interviewees...
-- The main/supporting check becomes a foreign key on character_types.

alter table public.characters
  drop constraint characters_character_type_check;

alter table public.characters
  add constraint characters_character_type_fkey
    foreign key (character_type) references public.character_types(key);
