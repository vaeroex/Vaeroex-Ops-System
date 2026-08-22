import type {
  QboProviderMetadata,
  QboReportType,
  QboSupportedObjectType
} from "@/lib/integrations/providers/qbo/contracts";

export const QBO_SYNTHETIC_PROVIDER: QboProviderMetadata = {
  providerKey: "quickbooks_online",
  realmId: "fictional-realm-12345",
  sourceEnvironment: "sandbox"
};

const metadata = {
  CreateTime: "2026-06-01T10:00:00.000Z",
  LastUpdatedTime: "2026-06-02T10:00:00.000Z"
};

export const QBO_SYNTHETIC_MASTER_FIXTURES: Record<string, unknown> = {
  CompanyInfo: {
    Id: "1",
    SyncToken: "0",
    MetaData: metadata,
    CompanyName: "Fictional Bakery Labs",
    LegalName: "Fictional Bakery Labs LLC",
    Country: "US",
    Email: { Address: "owner@example.invalid" },
    CompanyAddr: { Line1: "1 Imaginary Way" },
    PrimaryPhone: { FreeFormNumber: "555-0100" },
    realmId: "malicious-other-realm"
  },
  Preferences: {
    Id: "1",
    SyncToken: "0",
    MetaData: metadata,
    ReportPrefs: { ReportBasis: "Accrual" },
    CurrencyPrefs: { HomeCurrency: { value: "USD", name: "United States Dollar" } },
    UnsupportedCustomField: "ignore-me"
  },
  Account: {
    Id: "41",
    SyncToken: "2",
    MetaData: metadata,
    Name: "Operating Checking",
    AccountType: "Bank",
    AccountSubType: "Checking",
    Classification: "Asset",
    Active: true,
    CurrencyRef: { value: "USD", name: "United States Dollar" },
    AcctNum: "123456789",
    Description: "Do not preserve account description"
  },
  Customer: {
    Id: "101",
    SyncToken: "3",
    MetaData: metadata,
    DisplayName: "Fictional Customer",
    Active: true,
    PrimaryEmailAddr: { Address: "customer@example.invalid" },
    PrimaryPhone: { FreeFormNumber: "555-0101" },
    BillAddr: { Line1: "100 Customer Lane" },
    ShipAddr: { Line1: "101 Shipping Lane" }
  },
  Vendor: {
    Id: "201",
    SyncToken: "4",
    MetaData: metadata,
    DisplayName: "Fictional Vendor",
    Active: true,
    PrimaryEmailAddr: { Address: "vendor@example.invalid" },
    PrimaryPhone: { FreeFormNumber: "555-0102" },
    TaxIdentifier: "99-9999999",
    Vendor1099: true,
    BankAccountNumber: "000111222"
  },
  Item: {
    Id: "301",
    SyncToken: "5",
    MetaData: metadata,
    Name: "Fictional Service",
    Type: "Service",
    Active: true,
    IncomeAccountRef: { value: "401", name: "Services Revenue" },
    ExpenseAccountRef: { value: "501", name: "Service Expense" },
    PurchaseDesc: "Do not preserve purchase description",
    Description: "Do not preserve item description"
  }
};

const transactionBase = {
  SyncToken: "7",
  MetaData: metadata,
  TxnDate: "2026-06-15",
  CurrencyRef: { value: "USD", name: "United States Dollar" },
  ExchangeRate: "1",
  TotalAmt: "1250.00",
  PrivateNote: "Do not preserve private notes",
  CustomerMemo: { value: "Do not preserve customer memo" },
  Line: [
    {
      Id: "1",
      Amount: "1250.00",
      DetailType: "SalesItemLineDetail",
      Description: "Do not preserve line description",
      SalesItemLineDetail: {
        ItemRef: { value: "301", name: "Fictional Service" },
        AccountRef: { value: "401", name: "Services Revenue" }
      }
    }
  ]
};

type QboNonReportObjectType = Exclude<QboSupportedObjectType, QboReportType>;

export const QBO_SYNTHETIC_TRANSACTION_FIXTURES: Record<QboNonReportObjectType, unknown> = {
  CompanyInfo: QBO_SYNTHETIC_MASTER_FIXTURES.CompanyInfo,
  Preferences: QBO_SYNTHETIC_MASTER_FIXTURES.Preferences,
  Account: QBO_SYNTHETIC_MASTER_FIXTURES.Account,
  Customer: QBO_SYNTHETIC_MASTER_FIXTURES.Customer,
  Vendor: QBO_SYNTHETIC_MASTER_FIXTURES.Vendor,
  Item: QBO_SYNTHETIC_MASTER_FIXTURES.Item,
  Invoice: {
    ...transactionBase,
    Id: "501",
    CustomerRef: { value: "101", name: "Fictional Customer" },
    Balance: "250.00"
  },
  Payment: {
    ...transactionBase,
    Id: "502",
    CustomerRef: { value: "101", name: "Fictional Customer" },
    TotalAmt: "250.00",
    DepositToAccountRef: { value: "41", name: "Operating Checking" }
  },
  CreditMemo: {
    ...transactionBase,
    Id: "503",
    CustomerRef: { value: "101", name: "Fictional Customer" },
    TotalAmt: "75.00"
  },
  SalesReceipt: {
    ...transactionBase,
    Id: "504",
    CustomerRef: { value: "101", name: "Fictional Customer" },
    DepositToAccountRef: { value: "41", name: "Operating Checking" }
  },
  RefundReceipt: {
    ...transactionBase,
    Id: "505",
    CustomerRef: { value: "101", name: "Fictional Customer" },
    TotalAmt: "35.00"
  },
  Bill: {
    ...transactionBase,
    Id: "506",
    VendorRef: { value: "201", name: "Fictional Vendor" },
    APAccountRef: { value: "202", name: "Accounts Payable" }
  },
  BillPayment: {
    ...transactionBase,
    Id: "507",
    VendorRef: { value: "201", name: "Fictional Vendor" },
    TotalAmt: "500.00",
    BankAccountRef: { value: "41", name: "Operating Checking" }
  },
  VendorCredit: {
    ...transactionBase,
    Id: "508",
    VendorRef: { value: "201", name: "Fictional Vendor" },
    TotalAmt: "45.00"
  },
  Purchase: {
    ...transactionBase,
    Id: "509",
    AccountRef: { value: "41", name: "Operating Checking" },
    PaymentType: "Cash",
    CreditCardPayment: { CCAccountRef: { value: "secret-card" } }
  },
  Deposit: {
    ...transactionBase,
    Id: "510",
    DepositToAccountRef: { value: "41", name: "Operating Checking" }
  },
  Transfer: {
    ...transactionBase,
    Id: "511",
    FromAccountRef: { value: "41", name: "Operating Checking" },
    ToAccountRef: { value: "42", name: "Reserve Account" }
  },
  JournalEntry: {
    Id: "512",
    SyncToken: "1",
    MetaData: metadata,
    TxnDate: "2026-06-30",
    CurrencyRef: { value: "USD", name: "United States Dollar" },
    TotalAmt: "1250.00",
    Line: [
      {
        Id: "1",
        Amount: "1250.00",
        DetailType: "JournalEntryLineDetail",
        Description: "Do not preserve journal line description",
        JournalEntryLineDetail: {
          PostingType: "Debit",
          AccountRef: { value: "110", name: "Accounts Receivable" },
          Entity: { EntityRef: { value: "101", name: "Fictional Customer" } }
        }
      },
      {
        Id: "2",
        Amount: "1250.00",
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: {
          PostingType: "Credit",
          AccountRef: { value: "401", name: "Services Revenue" }
        }
      }
    ]
  }
};

function report(name: QboReportType) {
  return {
    Header: {
      ReportName: name,
      ReportBasis: name === "CashFlow" ? "Cash" : "Accrual",
      StartPeriod: "2026-06-01",
      EndPeriod: "2026-06-30",
      Currency: "USD",
      ExtraModernizedField: null
    },
    Columns: {
      Column: [
        { ColTitle: "", ColType: "Account" },
        { ColTitle: "Total", ColType: "Money" }
      ]
    },
    Rows: {
      Row: [
        {
          type: "Section",
          group: "Income",
          Header: { ColData: [{ value: "Income" }, { value: "" }] },
          Rows: {
            Row: [
              { type: "Data", ColData: [{ value: "Services Revenue", id: "401" }, { value: "1250.00" }] }
            ]
          },
          Summary: { ColData: [{ value: "Total Income" }, { value: "1250.00" }] }
        },
        {
          type: "Section",
          group: "Expenses",
          Header: { ColData: [{ value: "Expenses" }, { value: "" }] },
          Rows: {
            Row: [
              { type: "Data", ColData: [{ value: "Service Expense", id: "501" }, { value: "250.00" }] }
            ]
          },
          Summary: { ColData: [{ value: "Total Expenses" }, { value: "250.00" }] }
        }
      ]
    }
  };
}

export const QBO_SYNTHETIC_REPORT_FIXTURES: Record<QboReportType, unknown> = {
  ProfitAndLoss: report("ProfitAndLoss"),
  BalanceSheet: report("BalanceSheet"),
  CashFlow: report("CashFlow"),
  ARAgingSummary: report("ARAgingSummary"),
  APAgingSummary: report("APAgingSummary"),
  TrialBalance: report("TrialBalance")
};

export const QBO_SYNTHETIC_CLOUDEVENTS_FIXTURE = [
  {
    specversion: "1.0",
    id: "fictional-event-1",
    source: "intuit.fictional-source",
    type: "qbo.invoice.updated.v1",
    datacontenttype: "application/json",
    time: "2026-06-20T12:00:00.000Z",
    intuitentityid: "501",
    intuitaccountid: QBO_SYNTHETIC_PROVIDER.realmId,
    data: {}
  }
] as const;
