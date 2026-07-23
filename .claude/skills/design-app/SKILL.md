---
name: design-app
description: Use when someone wants to build an operational app in this workspace but has not decided what to model yet — "I want to track X", "can I build something for Y", "help me design an app". Turns an operator's daily work into collections, an agent policy, and views, before any file is written. Run this before new-app.
---

# Designing an operational app

The output of this skill is a short written design the operator agrees with, which
`new-app` then scaffolds. **Do not write files yet.** The failure mode here is modelling
data instead of modelling work.

## Start from the operator's day, not from the data

Ask, in this order, and keep it conversational — one or two questions at a time:

1. **What do you do repeatedly?** ("Every morning I check who signed up and message
   them.") The app exists to make one recurring loop faster.
2. **What decision do you make each time?** ("Whether this person is worth contacting.")
   This is the most important answer — see *the judgment field* below.
3. **What do you look at to decide?** That is your evidence.
4. **What do you produce?** A message, a quote, a ticket note. This is the **work
   product**, and it must be visible in the UI (see *the work-queue view*).
5. **What happens to it afterwards?** Sent, replied, closed, abandoned. That is a
   lifecycle, and lifecycles become `select` fields and board columns.

## Turn the answers into a model

- **The unit.** One row per *what*? Person, deal, ticket, shipment. Usually the noun in
  answer 1. This is your primary collection.
- **The lifecycle.** Answer 5 becomes a `select` field with explicit values. Order them
  as the work actually flows — a board renders one column per option, left to right.
- **The work product.** Answer 4 is usually its own collection (one row per message /
  quote / note) related to the unit, because there can be many over time.
- **The evidence.** Answer 3 is either fields on the unit, or an append-only collection
  if there are many events per unit. Be honest: an evidence collection only earns its
  place if the operator will really fill it. If nobody writes to it, delete it and put
  the evidence in a text field instead.

## Three checks that catch the usual mistakes

**1. The judgment field.** Whatever answer 2 was — "is this worth doing", "how good is
this lead", "is this urgent" — needs a **structured field with a fixed vocabulary**, not
a free-text note. If the recurring judgment lives only in prose, the operator can never
sort or filter by the one thing they actually decide, and every run re-reads the notes to
remember a conclusion already reached. Give it a `select`.

**2. Will any field stay empty?** For each field ask *where does this value come from?*
If the answer is "somewhere that doesn't capture it," the field will be empty forever and
is worse than nothing — it implies data you don't have. Cut it now.

**3. Is the work product visible?** Long-form content (a message body, a note) must be
in the view's `detail` list, or the operator can read everything *about* the work and
never the work itself. An app where you cannot see what you are about to send is a data
browser, not a tool.

## Decide what the AI may do

Default-deny. For each collection ask: may the agent **read** it, **create** rows,
**update** them, **delete** them? Grant the least that makes the loop work. Deletion is
almost never needed — a `Skipped`/`Archived` state beats a delete tool. Anything
irreversible or outward-facing (sending, paying, publishing) is the operator's job; the
app records that it happened, it does not do it.

Prefer a **constraint over an instruction**: a unique index enforces "no duplicates" even
when the model is careless, whereas a sentence in `instructions.md` is followed only when
the model reads and obeys it. Put invariants in the schema; put judgment in the prose.

## Write the design down

Before scaffolding, state back, in a dozen lines:

- the collections and their key fields, marking the lifecycle field and the judgment field
- what the agent may do per collection
- the views, starting with the **work queue**: what the operator opens first each day,
  what they read in it, and what they click when done

Get a yes, then run **new-app**.
