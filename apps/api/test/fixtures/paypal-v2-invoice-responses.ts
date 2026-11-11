export const paidMultipleTransactionsV2Response = {
  id: "PAYPAL-INV-1",
  status: "PAID",
  detail: {
    invoice_number: "PP-abc123xyz",
    metadata: { last_update_time: "2026-11-07T11:45:00Z" },
  },
  payments: {
    paid_amount: { currency_code: "USD", value: "150.00" },
    transactions: [
      {
        type: "PAYPAL",
        payment_id: "PAYMENT-TEST-001",
        method: "PAYPAL",
        payment_date: "2026-11-07",
        payment_date_time: "2026-11-07T12:15:00+02:00",
        amount: { currency_code: "USD", value: "50.00" },
      },
      {
        type: "PAYPAL",
        payment_id: "PAYMENT-TEST-002",
        method: "PAYPAL",
        payment_date: "2026-11-07",
        payment_date_time: "2026-11-07T11:30:45.123Z",
        amount: { currency_code: "USD", value: "100.00" },
      },
    ],
  },
  links: [{ rel: "payer-view", href: "https://www.sandbox.paypal.com/invoice/p/#sanitized" }],
};

export const dateOnlyPaidV2Response = {
  id: "PAYPAL-INV-1",
  status: "PAID",
  detail: {
    invoice_number: "PP-abc123xyz",
    metadata: { last_update_time: "2026-11-08T12:00:00Z" },
  },
  payments: {
    paid_amount: { currency_code: "USD", value: "150.00" },
    transactions: [
      { type: "EXTERNAL", method: "BANK_TRANSFER", payment_date: "2026-11-07", amount: { currency_code: "USD", value: "50.00" } },
      { type: "EXTERNAL", method: "CHECK", payment_date: "2026-11-08", amount: { currency_code: "USD", value: "100.00" } },
    ],
  },
  links: [{ rel: "payer-view", href: "https://www.sandbox.paypal.com/invoice/p/#sanitized" }],
};

export const partiallyPaidV2Response = {
  id: "PAYPAL-INV-1",
  status: "PARTIALLY_PAID",
  detail: { invoice_number: "PP-abc123xyz" },
  payments: {
    paid_amount: { currency_code: "USD", value: "50.00" },
    transactions: [
      {
        type: "PAYPAL",
        payment_id: "PAYMENT-TEST-003",
        method: "PAYPAL",
        payment_date: "2026-11-07",
        payment_date_time: "2026-11-07T11:00:00Z",
        amount: { currency_code: "USD", value: "50.00" },
      },
    ],
  },
  due_amount: { currency_code: "USD", value: "100.00" },
  links: [{ rel: "payer-view", href: "https://www.sandbox.paypal.com/invoice/p/#sanitized" }],
};

export const refundedV2Response = {
  id: "PAYPAL-INV-1",
  status: "REFUNDED",
  detail: { invoice_number: "PP-abc123xyz" },
  payments: {
    paid_amount: { currency_code: "USD", value: "150.00" },
    transactions: [
      {
        type: "PAYPAL",
        payment_id: "PAYMENT-TEST-004",
        method: "PAYPAL",
        payment_date: "2026-11-07",
        payment_date_time: "2026-11-07T11:00:00Z",
        amount: { currency_code: "USD", value: "150.00" },
      },
    ],
  },
  refunds: {
    refund_amount: { currency_code: "USD", value: "150.00" },
    transactions: [
      {
        type: "PAYPAL",
        refund_id: "REFUND-TEST-001",
        method: "PAYPAL",
        refund_date: "2026-11-09",
        amount: { currency_code: "USD", value: "150.00" },
      },
    ],
  },
  links: [{ rel: "payer-view", href: "https://www.sandbox.paypal.com/invoice/p/#sanitized" }],
};

export const missingPaymentDateV2Response = {
  id: "PAYPAL-INV-1",
  status: "PAID",
  detail: { invoice_number: "PP-abc123xyz" },
  payments: {
    transactions: [
      { type: "PAYPAL", method: "PAYPAL", payment_date_time: "2026-11-07T11:00:00Z" },
      { type: "PAYPAL", method: "PAYPAL" },
    ],
  },
  links: [{ rel: "payer-view", href: "https://www.sandbox.paypal.com/invoice/p/#sanitized" }],
};

export const invalidPaymentDateV2Response = {
  id: "PAYPAL-INV-1",
  status: "PAID",
  detail: { invoice_number: "PP-abc123xyz" },
  payments: {
    transactions: [
      { type: "PAYPAL", method: "PAYPAL", payment_date_time: "2026-02-31T11:00:00Z" },
      { type: "PAYPAL", method: "PAYPAL", payment_date: "2026-02-30" },
    ],
  },
  links: [{ rel: "payer-view", href: "https://www.sandbox.paypal.com/invoice/p/#sanitized" }],
};

export const invalidDateTimeWithValidDateV2Response = {
  id: "PAYPAL-INV-1",
  status: "PAID",
  detail: { invoice_number: "PP-abc123xyz" },
  payments: {
    transactions: [
      { type: "PAYPAL", method: "PAYPAL", payment_date_time: "2026-02-31T11:00:00Z", payment_date: "2026-11-07" },
    ],
  },
  links: [{ rel: "payer-view", href: "https://www.sandbox.paypal.com/invoice/p/#sanitized" }],
};

export const malformedPaymentDateTimeV2Responses = [
  {
    label: "invalid time component",
    response: {
      id: "PAYPAL-INV-1",
      status: "PAID",
      detail: { invoice_number: "PP-abc123xyz" },
      payments: { transactions: [{ type: "PAYPAL", method: "PAYPAL", payment_date_time: "2026-11-07T25:00:00Z" }] },
    },
  },
  {
    label: "invalid timezone offset",
    response: {
      id: "PAYPAL-INV-1",
      status: "PAID",
      detail: { invoice_number: "PP-abc123xyz" },
      payments: { transactions: [{ type: "PAYPAL", method: "PAYPAL", payment_date_time: "2026-11-07T11:00:00+25:00" }] },
    },
  },
];

export const offsetPaymentDateTimeV2Response = {
  id: "PAYPAL-INV-1",
  status: "PAID",
  detail: { invoice_number: "PP-abc123xyz" },
  payments: {
    transactions: [
      { type: "PAYPAL", method: "PAYPAL", payment_date_time: "2026-11-07T12:15:00+02:00" },
    ],
  },
  links: [{ rel: "payer-view", href: "https://www.sandbox.paypal.com/invoice/p/#sanitized" }],
};
