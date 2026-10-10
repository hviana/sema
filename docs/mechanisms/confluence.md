# Confluence — Where Independent Conditions Meet

Some questions state several conditions, and their answer lives in no single
fact, only where the conditions intersect. Each condition reaches its own stored
contexts, and the thing that satisfies all of them sits at their meeting point
(`src/mind/mechanisms/confluence.ts`, `confluenceJoin`).

## Matcher — streams from the climb

The streams are the consensus climb's ranked anchors (`pre.attention()`,
`crossRegionVotes`), each bound by identity to a discriminating span of the
question. Two streams are independent when their spans are disjoint. The meet is
a set intersection by content-addressed window identity (`windowsOf`): a window
present in both constraints' evidence and absent from the question.

**A constraint says what its anchor establishes.** An anchor binds the question
by its own bytes, but what it says of the open seat may be in its continuation.
`Porcelain is translucent` holds its entity itself. Under facts deposited by
subject (`wiki2.ts`), `Richard Fox mother` establishes
`The mother of Richard Fox is Mary Dudley.`, and only there is `Mary Dudley`. A
stream's evidence is therefore the anchor plus each continuation that still
speaks of what the anchor bound: one holding a constituent of it, by the rule
the anchor binds by (`bindsAConstituent`, a run of at least `2W`). Another
instance of the question binds its frame. Its answer (`The answer is Ashgrove.`,
or `The place of birth of Liu Yuan is Ashgrove.`) holds none of that frame, at
most a shard (`birt` of `birthplace`). A hub's continuations come back at the
read bound and add nothing.

## Gate — corpus-global commonality

A window's `reachOf` is gated by `dominates(reach, N)` (`commonality.md`). A
window reached by a majority of contexts is scaffolding: it never binds a
condition and never survives the meet. A minority reach is a filler, an entity.
A meet on a single window, or a span shorter than `2W`, is refused.

**The seat is a thing.** Where the question names a thing of its own, learnt
whole (`heldEntity` with `entitiesIn`'s law: continuations and company of its
own, read under the equivalence), what it asks for is a thing too. A meet that
holds no such thing (`holdsAThing`) is no answer. What two facts of one relation
share is that relation's frame (`The date of birth of`), and its windows can
read rarer than any entity. Where the question names nothing learnt whole
(`Which material is translucent and featherlight?`), the bytes are all the
evidence spells.

Read off the anchors alone, the meet of two subject-deposited facts is the
relation they share, voiced as the answer (`date of birth` for
`Who was born later, X or Y?`). Reading what the anchors establish answers 9
such 2Wiki questions with the fact that decides them, and names a shared
birthplace asked in words no stored context spells
(`In which city were both X and Y born?`).

## Where instances show how the constraints meet

A question about two things (`Who is the shared grandfather of A and B?`) is
read off its instances the way a one-thing question is (`evidence.md`), with the
slot parted at the longest run the two forms share (`and`) where each side holds
a thing learnt whole (`convergenceOf`), not where names share letters. An
instance answered `The answer is G.` shows a CONVERGENCE: each of its things
reaches a fact holding the answer, by a derivation of its own
(`· father → · father` from A, `· mother → · father` from B, the shortest path
the corpus holds). The answer is what the instance's continuation holds beyond
the frame every instance's continuation shares (`The answer is` and `.`),
exactly; a shared part shorter than one window is not frame. An answer that is
itself a fact (`The father of Konrad Fenwick is Ignatius Fenwick.`) holds more
than one thing: the run every other instance's answer holds inside it (`is`)
parts it into pieces, as a shared run parts the slot. Where both things reach
the whole answer, it is the instance's; else each piece both reach is a reading,
and agreement between instances decides. The bytes around the entity stood on
and the answer are that last fact's ANSWER FRAME (`The father of`, the entity,
the answer). Two instances that spell the same pair of derivations and frames
agree, keyed by the question's things, whichever parting read them.

At the question, each derivation is replayed from its own thing, the answer is
read off each last fact by its frame, and the two are compared byte for byte
(`convergenceMeets`). A meet is the join's answer, the two facts its evidence;
two grandfathers that share a first name do not meet. The entity met at holds
what every instance's meeting entity holds, as a path's entities do
(`evidence.md`), whichever route each instance took. The instances' things and
derivations do not depend on the question and are read once per session, each
form's in its own spelling.

On the constructed world, every same-phrasing two-thing question (mother∧spouse,
shared birthplace, shared grandfather) is answered in either deposit order, the
grandfather (3 of 3) only by the meet; scrambled or absent instances leave it
unanswered. A phrasing no instance spells has no reading.

The meet explains to the market what its evidence explains, and no more: the
frame every agreeing instance shares with the question, the run that parts the
two things, and the two things. A condition the instances never asked
(`…, the one who is a surgeon?`) is left unexplained and is priced like any
unexplained byte.

Where the two derivations meet nowhere, nothing is concluded. The meet may lie
on a route the instances did not show, or past the read bound, or a premise may
be missing. An empty meet is the absence of a proof, not a refutation, and other
mechanisms answer as they would without it (`failures/tempting-but-wrong.md`,
trap 14).

## Cost

`3·STEP`: two conditions and the meet. A convergence pays a `STEP` per step of
each derivation, plus the meet. `3·STEP` is the floor, so the climb is never
touched unless `worthRunning(3·STEP)` holds (`mechanism-market.md`).

## Provenance

`join`, which belongs to this mechanism alone.

## Pins

- `test/32` — two-condition intersection, invariance to the order of the
  conditions, honest silence on an empty intersection, and relational joins
  across domains. Section G: under facts deposited by subject, the meet is read
  off what the anchors establish; the relation two facts share is no seat; a
  continuation is evidence only of what its anchor bound.
- `test/159` — a question about two things: a two-step convergence meets at the
  shared grandfather in either deposit order; the answer is met whole; instances
  parting the slot differently still agree, names sharing letters part none; an
  empty meet refutes nothing, a read past the bound metered; instances answered
  with a fact teach the part both sides reach; a frame word is not a thing; the
  meet explains the frame, the parting and the two things only; the meet holds
  what every instance's meeting entity holds, even by accident; scrambled
  answers meet nothing.
