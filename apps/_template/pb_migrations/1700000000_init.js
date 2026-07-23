/// <reference path="../pb_data/types.d.ts" />

// Starter schema for a new app — rename the collection(s) and fields to fit the domain.
// Rules are open ("") for v0: a single local operator bound to localhost (PRD §9).
//
// When you copy this template, rename this file to a fresh timestamp so migrations order
// correctly, e.g.  mv 1700000000_init.js "$(date +%s)_init.js"
migrate(
  (app) => {
    const items = new Collection({
      type: "base",
      name: "items",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { type: "text", name: "title", required: true, max: 200 },
        { type: "text", name: "notes", max: 2000 },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["Open", "Doing", "Done"],
        },
        { type: "autodate", name: "created", onCreate: true },
        // Stamped by the "Mark done" action in views.json via the "@now" token.
        { type: "date", name: "done_at" },
      ],
    })
    app.save(items)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("items"))
  }
)
