/// <reference path="../pb_data/types.d.ts" />

// Sales workspace schema — source of truth for the data model.
// Rules are open ("") for v0: single local operator bound to localhost.
migrate(
  (app) => {
    const companies = new Collection({
      type: "base",
      name: "companies",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { type: "text", name: "name", required: true, max: 200 },
        { type: "text", name: "industry", max: 100 },
        { type: "text", name: "contact", max: 200 },
        { type: "email", name: "email" },
      ],
    })
    app.save(companies)

    const opportunities = new Collection({
      type: "base",
      name: "opportunities",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { type: "text", name: "name", required: true, max: 200 },
        { type: "text", name: "company", max: 200 },
        { type: "number", name: "value", min: 0 },
        {
          type: "select",
          name: "stage",
          required: true,
          maxSelect: 1,
          values: ["Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost"],
        },
        { type: "text", name: "owner", max: 100 },
        { type: "date", name: "close_date" },
      ],
    })
    app.save(opportunities)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("opportunities"))
    app.delete(app.findCollectionByNameOrId("companies"))
  }
)
