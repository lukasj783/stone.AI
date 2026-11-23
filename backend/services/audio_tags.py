"""Turn screenplay parentheticals into ElevenLabs audio tags.

Eleven v3 and v4 take delivery directions inline as short instructions in square
brackets, placed where the delivery should change: ``[whispers]``, ``[sarcastic]``,
``[laughs]``, ``[short pause]``. They do not support SSML break tags, so pauses become
the ``[short pause]`` / ``[long pause]`` tags.

A screenplay parenthetical mixes how a line sounds with things that are not sound:

    (whispering)            -> [whispers]
    (sarcastically, beat)   -> [sarcastically] [short pause]
    (to Amina, laughing)    -> [laughs]          "to Amina" is who they talk to
    (V.O.) / (CONT'D)       -> nothing           screenplay extensions
    (lighting a cigarette)  -> nothing           physical action, not voice

A short direction is kept unless it is clearly not about the voice: a screenplay
extension, who the line is aimed at, a place, or physical business ("pointing to the
bottle"), which is cut off so the delivery before it survives ("excitedly pointing to
the bottle" -> [excitedly]). Tone descriptions in adverts ("warm and inviting", "deep,
gritty") are delivery, so they stay. Everything dropped is reported back for the UI.
"""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field


SHORT_PAUSE = "short pause"
LONG_PAUSE = "long pause"
PAUSE_TAGS = frozenset({SHORT_PAUSE, LONG_PAUSE})
MAX_TAG_WORDS = 5
MAX_LEADING_TAGS = 4

# Screenplay extensions and technical notes: never voice directions.
_EXTENSION_PATTERN = re.compile(
    r"^(?:v\.?\s?o\.?|o\.?\s?s\.?|o\.?\s?c\.?|cont(?:'|’)?d|cont\.?|continuing|continued|more|"
    r"pre-?lap|filtered|subtitled?|translated|voice[- ]?over|off[- ]?(?:screen|camera)|"
    r"(?:on|into|over|through) (?:the |a )?(?:phone|radio|walkie(?:-talkie)?|intercom|speaker|mic(?:rophone)?|tv|television|megaphone)|"
    r"in [a-z]+|reading|read(?:s)? aloud)$"
)
_SHORT_PAUSE_PATTERN = re.compile(r"^(?:a |another |short |brief |quick )?(?:beat|pause|moment|breath)s?$|^pausing$")
_LONG_PAUSE_PATTERN = re.compile(r"^(?:a )?(?:long|longer|extended|awkward|heavy) (?:beat|pause|silence|moment)$|^silence$")
# Who the line is aimed at ("to Amina", "at the screen"): not how it sounds.
_ADDRESSEE_PATTERN = re.compile(r"^(?:to|at|toward|towards|re:?)\s+")
_TO_SELF_PATTERN = re.compile(r"^to (?:himself|herself|themselves|themself|myself|oneself|self)$")
# A vocal direction followed by stage business: "laughing at him" -> "laughing".
# "to" is not cut: "about to cry" and "trying not to laugh" are the delivery itself.
_TRAILING_STAGE_PATTERN = re.compile(r"\s+(?:at|toward|towards|into|as|while|before|after)\s+.*$")
# Where someone is, not how they sound: "in the car", "from the doorway".
_LOCATION_PATTERN = re.compile(
    r"^(?:in|on|at|from|inside|outside|behind|near|by|under|beside|across|through|into|onto|off|over)\s+"
    r"(?:the|his|her|their|a|an|my|our|its|this|that)\b"
)
# "in a low voice", "with a smile": descriptive only when what follows is vocal.
_DESCRIPTIVE_FILLER_PATTERN = re.compile(r"^(?:in|with) an? ")
_CONJUNCTION_PATTERN = re.compile(r"^(?:and|but|yet|or|still)\s+")
# Physical business. The direction is cut where it starts; nothing left means no tag.
_PHYSICAL_VERBS = frozenset("""
    pointing points holding holds lighting walking walks running runs turning turns
    looking looks glancing glances staring stares standing stands sitting sits grabbing grabs raising raises
    lifting lifts nodding nods shaking shakes waving waves opening opens closing closes picking picks putting
    puts handing hands reaching reaches leaning leans sipping sips drinking drinks eating eats typing types
    writing writes pacing paces entering enters leaving leaves crossing crosses gesturing gestures showing
    shows tapping taps pouring pours smoking smokes hugging hugs kissing kisses touching touches pushing
    pushes pulling pulls throwing throws catching catches kneeling kneels wiping wipes adjusting adjusts
    checking checks packing packs dropping drops peering peers watching watches nudging nudges clutching
    clutches gripping grips offering offers indicating indicates motioning motions cradling cradles rubbing
    rubs scratching scratches folding folds dialing dials hanging hangs lowering lowers sliding slides
    stepping steps jumping jumps climbing climbs driving drives cooking cooks cleaning cleans beating beats
    drying dries dancing dances shrugging shrugs winking winks blinking blinks
    toasting toasts clinking clinks unscrewing popping pops
    sprinting rushing rushes storming storms backing backs approaching approaches exiting exits
""".split())
_PARENTHETICAL_PATTERN = re.compile(r"\(([^()]*)\)")
_BRACKET_PATTERN = re.compile(r"\[([^\[\]]+)\]")
_PRONOUN_PATTERN = re.compile(r"\b(?:his|her|their|its|my)\s+")

# Exact phrases rewritten to the wording ElevenLabs documents.
_CANONICAL_TAGS: dict[str, str] = {
    "whisper": "whispers", "whispering": "whispers", "whispered": "whispers", "in a whisper": "whispers",
    "shout": "shouts", "shouting": "shouts", "yelling": "shouts", "yells": "shouts", "yell": "shouts",
    "laugh": "laughs", "laughing": "laughs", "laughter": "laughs",
    "chuckle": "chuckles", "chuckling": "chuckles",
    "giggle": "giggles", "giggling": "giggles",
    "sigh": "sighs", "sighing": "sighs",
    "sobbing": "crying", "sobs": "crying", "in tears": "crying", "tearful": "crying", "tearfully": "crying",
    "clearing throat": "clears throat", "clears throat": "clears throat",
    "gasp": "gasps", "gasping": "gasps",
    "exhaling": "exhales", "exhale": "exhales",
    "inhaling": "inhales deeply", "inhale": "inhales deeply", "deep breath": "inhales deeply",
    "taking a deep breath": "inhales deeply", "takes a deep breath": "inhales deeply",
    "swallowing": "swallows", "gulping": "gulps",
    "singing": "sings", "sing": "sings",
    "to himself": "under breath", "under breath": "under breath",
    "sotto": "quietly", "sotto voce": "quietly",
}

# Words that make a direction about the voice. Base forms; see ``_word_forms``.
# Words that are mostly stage business in participle form stay out ("beating the drum",
# "drying her hands", "warming up"); their adverbs still count ("dryly", "warmly").
_VOCAL_WORDS = frozenset("""
    happy sad excited angry annoyed appalled thoughtful surprised sarcastic curious crying cry professional
    reassuring sympathetic nervous scared afraid frightened terrified anxious worried calm cheerful
    cold bitter tender gentle playful mischievous teasing tease flirtatious flirty confused hesitant shocked
    desperate furious hurt proud embarrassed shy tired exhausted bored serious stern firm sincere defensive
    pleading plead begging beg triumphant resigned deadpan wry amused disgusted relieved hopeful dreamy
    wistful solemn grim menacing threatening mocking mock icy breathless drunk sleepy groggy emotional choked
    trembling tremble shaky quiet loud soft low flat monotone dramatic urgent rushed slow fast panicked
    panic frantic sheepish smug cocky confident uncertain unsure awkward impatient irritated frustrated
    exasperated incredulous disbelieving skeptical suspicious sweet bright cheery gruff hoarse raspy husky
    sultry deep gritty gravelly booming breathy nasal crisp smooth rich powerful commanding authoritative
    energetic upbeat enthusiastic friendly casual conversational intimate epic ominous mysterious eerie
    haunting bold punchy velvety silky resonant cinematic intense passionate fierce aggressive hyped
    emphatic measured deliberate theatrical heroic sinister soothing calming inviting welcoming persuasive
    delighted astounded refreshed disappointed pride panting
    sing singing sings whisper whispers shout shouts laugh laughs giggle giggles chuckle chuckles sigh
    sighs gasp gasps exhale exhales inhale inhales throat sniffle sniffles cough coughs groan groans scoff
    scoffs snort snorts sob sobs scream screams mutter mutters mumble mumbles murmur murmurs stammer stammers
    stutter stutters hum hums yawn yawns swallow swallows gulp gulps smile smiling grin grinning accent
    voice tone breath breathing softer louder quieter faster slower overjoyed joyful elated
    gleeful heartbroken grieving mournful sorrowful sombre somber shaken weary bitterly
""".split())


@dataclass(frozen=True)
class TaggedText:
    """One spoken line ready for ElevenLabs, plus what the conversion did."""

    text: str
    tags: tuple[str, ...] = ()
    dropped: tuple[str, ...] = field(default_factory=tuple)


def _normalise_piece(piece: str) -> str:
    piece = piece.replace("’", "'").replace("…", "...").strip().strip(".!?;:-–—").strip()
    return " ".join(piece.lower().split())


def _word_forms(word: str) -> set[str]:
    """Crude stems so adverbs and participles hit ``_VOCAL_WORDS`` (angrily -> angry)."""
    forms = {word}
    if word.endswith("ically"):
        forms.add(word[:-4])  # sarcastically -> sarcastic
    if word.endswith("ily"):
        forms.add(word[:-3] + "y")  # angrily -> angry
    if word.endswith("ly"):
        forms.update({word[:-2], word[:-1] + "e"})  # softly -> soft, gently -> gentle
    if word.endswith("ing"):
        forms.update({word[:-3], word[:-3] + "e"})  # whispering -> whisper, smiling -> smile
        if len(word) > 5 and word[-4] == word[-5]:
            forms.add(word[:-4])  # sobbing -> sob
    if word.endswith("ed"):
        forms.update({word[:-2], word[:-1]})
    if word.endswith("s"):
        forms.add(word[:-1])
    return forms


def _is_vocal(phrase: str) -> bool:
    words = re.findall(r"[a-z']+", phrase)
    if len(words) == 1 and words[0].endswith("ly") and len(words[0]) > 4:
        return True  # any single adverb is a delivery: (mischievously), (wearily)
    return any(_word_forms(word) & _VOCAL_WORDS for word in words)


def direction_to_tag(direction: str) -> str | None:
    """One direction ("whispering", "beat", "to Amina") as a tag, or None when it is not voice."""
    piece = _normalise_piece(direction)
    if not piece:
        return None
    # Before the other checks: "in tears" is not "in Swahili", "under her breath" is not a place.
    for candidate in (piece, _PRONOUN_PATTERN.sub("", piece).strip()):
        if candidate in _CANONICAL_TAGS:
            return _CANONICAL_TAGS[candidate]
    if _EXTENSION_PATTERN.match(piece):
        return None
    if _LONG_PAUSE_PATTERN.match(piece):
        return LONG_PAUSE
    if _SHORT_PAUSE_PATTERN.match(piece):
        return SHORT_PAUSE
    if _TO_SELF_PATTERN.match(piece):
        return "under breath"
    piece = _CONJUNCTION_PATTERN.sub("", piece)
    if _ADDRESSEE_PATTERN.match(piece):
        return None
    if _DESCRIPTIVE_FILLER_PATTERN.match(piece):
        piece = _DESCRIPTIVE_FILLER_PATTERN.sub("", piece)
        if not _is_vocal(piece):
            return None  # "in a car", "with a gun"
    elif _LOCATION_PATTERN.match(piece):
        return None
    piece = _cut_physical_business(_TRAILING_STAGE_PATTERN.sub("", piece))
    piece = _PRONOUN_PATTERN.sub("", piece).strip()
    if not piece:
        return None
    if piece in _CANONICAL_TAGS:
        return _CANONICAL_TAGS[piece]
    # Short directions are delivery unless shown otherwise; long ones must name the voice.
    if len(piece.split()) > MAX_TAG_WORDS and not _is_vocal(piece):
        return None
    return piece


def _cut_physical_business(piece: str) -> str:
    """'excitedly pointing to the bottle' -> 'excitedly'; 'pointing to her bottle' -> ''."""
    words = piece.split()
    if "voice" in words:
        return piece  # "voice shaking" describes the voice itself
    for index, word in enumerate(words):
        if word.strip(",.") in _PHYSICAL_VERBS:
            return " ".join(words[:index])
    return piece


def _split_directions(text: str) -> list[str]:
    inner = text.strip()
    if inner.startswith("(") and inner.endswith(")"):
        inner = inner[1:-1]
    # Commas, semicolons and slashes separate directions; "then" chains them.
    return [part for part in re.split(r"\s*(?:[,;/]|\bthen\b)\s*", inner) if part.strip()]


def directions_to_tags(directions: Iterable[str]) -> tuple[list[str], list[str]]:
    """(tags, dropped) for every direction in every parenthetical, deduplicated, in order."""
    tags: list[str] = []
    dropped: list[str] = []
    for text in directions:
        for piece in _split_directions(text or ""):
            tag = direction_to_tag(piece)
            if tag is None:
                dropped.append(piece.strip())
            elif tag not in tags:
                tags.append(tag)
    return tags, dropped


def _format_tags(tags: Iterable[str]) -> str:
    return " ".join(f"[{tag}]" for tag in tags)


def _inline_parentheticals(content: str, dropped: list[str]) -> str:
    """Replace "(beat)" inside a line with its tags; non-voice asides disappear."""
    def replace(match: re.Match[str]) -> str:
        tags, lost = directions_to_tags([match.group(1)])
        dropped.extend(lost)
        return f" {_format_tags(tags)} " if tags else " "

    return _PARENTHETICAL_PATTERN.sub(replace, content)


def _trim_edge_pauses(text: str) -> str:
    """A pause before the first word or after the last one is just silence in the clip."""
    pause = r"\[(?:short|long) pause\]"
    text = re.sub(rf"^(?:\s*{pause})+\s*", "", text)
    return re.sub(rf"(?:\s*{pause})+\s*$", "", text)


def _metadata_directions(metadata: Mapping[str, object] | None) -> list[str]:
    """Dialogue blocks may carry ``emotion`` / ``delivery`` in metadata."""
    if not isinstance(metadata, Mapping):
        return []
    return [str(metadata[key]) for key in ("emotion", "delivery") if isinstance(metadata.get(key), str) and str(metadata[key]).strip()]


def to_elevenlabs_text(
    content: str,
    parentheticals: Iterable[str | None] = (),
    metadata: Mapping[str, object] | None = None,
) -> TaggedText:
    """The text ElevenLabs should speak for one script line.

    ``parentheticals`` (the block's own and any parenthetical block before it) become
    leading tags; parentheticals written inside the line become tags in place. Tags
    the writer already put in square brackets are kept as they are.
    """
    dropped: list[str] = []
    leading, lost = directions_to_tags([*(p for p in parentheticals if p), *_metadata_directions(metadata)])
    dropped.extend(lost)
    leading = [tag for tag in leading if tag not in PAUSE_TAGS][:MAX_LEADING_TAGS]

    body = _inline_parentheticals(content or "", dropped)
    body = " ".join(body.split())
    existing = {_normalise_piece(tag) for tag in _BRACKET_PATTERN.findall(body)}
    leading = [tag for tag in leading if tag not in existing]

    text = _trim_edge_pauses(f"{_format_tags(leading)} {body}".strip())
    inline_tags = [_normalise_piece(tag) for tag in _BRACKET_PATTERN.findall(body)]
    all_tags = tuple(dict.fromkeys([*leading, *(tag for tag in inline_tags if tag)]))
    return TaggedText(text=" ".join(text.split()), tags=all_tags, dropped=tuple(d for d in dropped if d))
