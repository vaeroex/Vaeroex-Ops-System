export const businessProblems = [
  {
    id: "hallucinated-answers",
    order: "First",
    title: "Hallucinated answers",
    problem: [
      "Ever asked AI a question and received an answer you knew was wrong?",
      "You ask again and get a different answer—sometimes one that has nothing to do with your question.",
      "Now you still need the answer, and you have another job: checking whether you can trust it."
    ],
    solution: [
      "VSI helps prevent hallucinated answers by checking its business conclusions for support, consistency, and relevance. It challenges its own conclusions before presenting them.",
      "When there isn’t enough information, it explains what’s missing and what you can provide next."
    ],
    takeaway: "An answer should hold up to questions—including its own."
  },
  {
    id: "manual-comparison",
    order: "Second",
    title: "Manual comparison",
    problem: [
      "Without a reliable explanation, you start investigating yourself.",
      "Your sales report shows growth. Your bookkeeping shows higher expenses. Staffing records and supplier bills may hold other clues.",
      "Finding the connection means opening different systems, matching dates, and comparing numbers. You may not have an analyst—or the time to become one."
    ],
    solution: [
      "Vaeroex brings available information from connected tools, uploaded reports, and business notes together to help explain what changed.",
      "Higher supplier costs, heavier discounts, or a change in what customers buy can each affect margins differently. Vaeroex helps narrow down what the evidence supports and what still needs checking."
    ],
    takeaway: "Spend less time assembling the information and more time understanding it."
  },
  {
    id: "unclear-priorities",
    order: "Third",
    title: "Unclear priorities",
    problem: [
      "Once you understand what changed, you still have to decide what comes first.",
      "Should you review pricing, investigate supplier costs, or adjust staffing? Which issue needs attention now? Is there something working well that deserves more investment?",
      "Without clear priorities, finding the answer can lead to another round of uncertainty."
    ],
    solution: [
      "Vaeroex helps you sort findings into practical priorities, explains why they matter, and suggests next steps.",
      "You can weigh the problems and opportunities, then decide where to focus your time."
    ]
  },
  {
    id: "unclear-results",
    order: "Fourth",
    title: "Unclear results",
    problem: [
      "You make a change. Now you need to know whether it helped.",
      "Did the pricing adjustment improve margins? Did reducing costs affect service? Did one result improve while another slipped?",
      "Checking the outcome can send you straight back to comparing reports."
    ],
    solution: [
      "Vaeroex helps you review updated numbers alongside the changes you recorded in your business notes.",
      "You can assess what improved, what still needs attention, and whether another adjustment is worth considering."
    ]
  },
  {
    id: "keeping-up-with-growth",
    order: "Fifth",
    title: "Keeping up with growth",
    problem: [
      "As the business grows, there’s more to manage: more activity, more information, and more decisions.",
      "The approach that worked when things were smaller can start taking too much time. Questions pile up, and the same cycle begins again."
    ],
    solution: [
      "Vaeroex helps you maintain a clear view as the business changes—bringing information together, highlighting priorities, and helping you review progress without rebuilding the analysis from scratch each time.",
      "Whether you’re addressing a problem or exploring an opportunity, you have a place to keep the information and decisions connected."
    ]
  }
] as const;

export const whyVaeroexFaqs = [
  ["Is VSI a chatbot?", "VSI is the intelligence behind Vaeroex. Chat is one way to use it. It also powers how Vaeroex analyzes business information, explains findings, and helps you evaluate priorities across the platform."],
  ["Can I ask everyday questions too?", "Yes. You can ask for breakfast ideas, help planning a trip, or other everyday assistance. When you have a business question, Vaeroex can work with the business information available in your workspace."],
  ["How does Vaeroex look at my business from different perspectives?", "A decision can affect more than one part of your business. Vaeroex helps you examine the financial, operational, customer, marketing, and technology implications together—the perspectives a leadership team would consider. You remain responsible for the decision."],
  ["My existing software already has AI. Why would I use Vaeroex?", "Those features can be valuable. Vaeroex helps when your question reaches across several tools and you need to understand how their information fits together. It adds a place to compare available information, include your business context, and investigate the question as a whole."],
  ["How does VSI help prevent hallucinated answers?", "VSI combines business calculations with checks on the support, consistency, and relevance of its conclusions. It challenges its own interpretation and identifies missing information when it cannot adequately support an answer."],
  ["What happens if I haven’t provided enough information?", "Vaeroex explains what it can establish, what remains unanswered, and what additional information would help. That could mean a missing report, a different date range, or context about a change in your business."],
  ["Do I need to connect every system before I can use it?", "You can start with the information you have. The questions Vaeroex can answer depend on the records and context available. Additional information can help it investigate more of the business."],
  ["Will Vaeroex make changes to my business for me?", "Its findings and suggested actions help you decide what to do. You review recommendations and confirm supported actions before records are created or changed."]
] as const;
