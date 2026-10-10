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

Read off the anchors alone, the meet of two subject-deposited facts was the
relation they share, voiced as the answer (`date of birth` for
`Who was born later, X or Y?`). On the 2Wiki fixtures, reading what the anchors
establish turned 9 such answers into the fact that decides them, with no answer
lost; bytes read rose about 1% on the questions whose answer did not change. On
a constructed world, a shared birthplace asked in words no stored context spells
(`In which city were both X and Y born?`) is now named.

## Where instances show how the constraints meet

A question about two things (`Who is the shared grandfather of A and B?`) is
read off its instances the way a one-thing question is (`evidence.md`), with the
slot parted where the two forms share a run (`and`), each side holding a thing
learnt whole (`convergenceOf`). An instance answered `The answer is G.` shows a
CONVERGENCE: each of its things reaches a fact holding the answer, by a
derivation of its own (`· father → · father` from A, `· mother → · father` from
B, the shortest path the corpus holds). The answer is what the instance's
continuation holds beyond the frame every instance's continuation shares
(`The answer is` and `.`), exactly; a shared part shorter than one window is not
frame. An answer that is itself a fact
(`The father of Konrad Fenwick is Ignatius Fenwick.`) holds more than one thing:
the run every other instance's answer holds inside it (`is`) parts it into
pieces, as a shared run parts the slot. Where both things reach the whole
answer, it is the instance's; else each piece both reach is a reading, and
agreement between instances decides. The bytes around the entity stood on and
the answer are that last fact's ANSWER FRAME (`The father of`, the entity, the
answer). Two instances that spell the same pair of derivations and frames agree,
keyed by the question's things, whichever parting read them.

At the question, each derivation is replayed from its own thing, the answer is
read off each last fact by its frame, and the two are compared byte for byte
(`convergenceMeets`). A meet is the join's answer, the two facts its evidence;
two grandfathers that share a first name do not meet. The instances' things and
derivations do not depend on the question and are read once per session; the
question's own things are read only once an instance shows a convergence. A
form's things are read in its own spelling, never under the equivalence.

Measured on the constructed world: with instances answered `The answer is E.`,
or with the fact that decides them, every same-phrasing two-thing question
(mother∧spouse, shared birthplace, shared grandfather) is answered by the meet,
the grandfather 0 → 3 of 3, in both deposit orders; scrambled answers and no
instances change nothing. Asked in a phrasing no instance spells, a question has
no reading: nothing in the corpus says the two phrasings ask the same. With
instances in that phrasing too, it does (shared grandfather 0 → 3, shared
birthplace +1). The 2Wiki fixtures and the 31.7M-node battery change no answer;
branch lookups rise 0.3% on two fixtures.

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

`3·STEP`: two conditions and the meet. That is also its floor, so the climb is
never touched unless `worthRunning(3·STEP)` holds (`mechanism-market.md`).

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
  parting the slot differently still agree; an empty meet refutes nothing;
  instances answered with a fact teach the part both sides reach; a frame word
  is not a thing; the meet explains the frame, the parting and the two things,
  and no more; scrambled answers meet nothing.
