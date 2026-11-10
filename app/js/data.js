'use strict';
/* ============ Constants, master-data definitions (Business Central tables), seed ============ */
const ROLES = [
  'System Admin', 'Requester', 'Department Head', 'Purchasing Assistant', 'Supply Chain Specialist',
  'Supply Chain & Admin Head', 'Warehouseman', 'AP Accounting Associate', 'General Accounting Supervisor',
  'Executive Assistant to the President', 'Special Assistant to the President', 'Commercial Manager', 'President',
  'Accounting Manager - Shared Service', 'BU Accounting Manager', 'G/L Accountant', 'Treasury Supervisor',
  'Treasury Assistant Manager', 'Billing / Sales Associate', 'ICT Head', 'Supply Chain Manager', 'Supply Chain VP', 'CLG', 'CFO'
];
const ACCOUNT_TYPES = ['Posting', 'Heading', 'Total', 'Begin-Total', 'End-Total'];
const ACCOUNT_CATEGORIES = ['', 'Assets', 'Liabilities', 'Equity', 'Income', 'Cost of Goods Sold', 'Expense'];
const APPROVAL_CONDITIONS = [
  ['always', 'Always'], ['withinBudget', 'Only if within budget'], ['outsideBudget', 'Only if outside budget / no budget'],
  ['ga', 'Only if General & Admin expense'], ['notGa', 'Only if Direct/Indirect cost or Inventory'], ['capex', 'Only if Capital Expenditure (fixed asset)'],
  ['intlTravel', 'Only if International Travel'], ['capexOrOutside', 'If CAPEX, International Travel, or outside budget'], ['amountGte', 'Only if amount ≥ threshold']
];
const DOC_TYPES_FOR_RULES = ['PR', 'PQ', 'PO', 'PI', 'PRET', 'PAY', 'SI', 'SCM', 'CR', 'TO', 'IJ', 'PC', 'GJ', 'MASTER'];
const YESNO = [['', ''], ['true', 'Yes'], ['false', 'No']];

/* ---------- Master data screens ----------
   scope 'md' = belongs to the business unit's Master Data Set (like a BC company's setup);
   otherwise stored once for the whole group. key may be composite ("bus,prod"). */
const A = (k, l, extra = {}) => ({ k, l, t: 'ref', ref: 'accounts', ...extra });
const R = (k, l, ref, extra = {}) => ({ k, l, t: 'ref', ref, ...extra });
const T = (k, l, extra = {}) => ({ k, l, ...extra });
const MASTERS = {
  vendors: { md: 1, title: 'Vendors', single: 'Vendor', key: 'no', approval: true, group: 'Purchasing',
    desc: 'Vendor card. New vendors need BIR Certificate of Registration and sample O.R., then approval (ICT Head → Accounting Manager - Shared Service).',
    cols: [{ l: 'No.', k: 'no' }, { l: 'Name', k: 'name' }, { l: 'TIN', k: 'tin' }, { l: 'Vendor Posting Group', k: 'postingGroup' }, { l: 'Gen. Bus.', k: 'genBus' }, { l: 'VAT Bus.', k: 'vatBus' }, { l: 'WHT Bus.', k: 'whtBus' }, { l: 'Status', k: 'status', html: r => badge(r.status) }],
    fields: [T('no', 'No.', { req: 1 }), T('name', 'Name', { req: 1, w: 'w2' }), T('tin', 'VAT Registration No. (TIN)', { req: 1 }), T('address', 'Address', { w: 'w2' }), T('city', 'City'),
      T('contact', 'Contact'), T('phone', 'Phone No.'), T('email', 'Email'),
      R('postingGroup', 'Vendor Posting Group', 'vendPostGroups', { req: 1 }), R('genBus', 'Gen. Bus. Posting Group', 'genBus', { req: 1 }), R('vatBus', 'VAT Bus. Posting Group', 'vatBus', { req: 1 }),
      R('whtBus', 'WHT Bus. Posting Group', 'whtBus'), R('paymentTerms', 'Payment Terms Code', 'paymentTerms'), R('paymentMethod', 'Payment Method Code', 'paymentMethods'),
      R('currency', 'Currency Code (blank = PHP)', 'currencies'), T('pricesInclVat', 'Prices Including VAT', { t: 'check' }), R('icPartner', 'IC Partner Company (blank = from legal name)', 'companies'),
      T('birCor', 'BIR Certificate of Registration received', { t: 'check' }), T('sampleOR', 'Sample O.R. received', { t: 'check' })] },
  customers: { md: 1, title: 'Customers', single: 'Customer', key: 'no', approval: true, group: 'Sales',
    desc: 'Customer card. Requires BIR Certificate of Registration and sample O.R., then approval.',
    cols: [{ l: 'No.', k: 'no' }, { l: 'Name', k: 'name' }, { l: 'TIN', k: 'tin' }, { l: 'Customer Posting Group', k: 'postingGroup' }, { l: 'Gen. Bus.', k: 'genBus' }, { l: 'Currency', k: 'currency' }, { l: 'Credit Limit', k: 'creditLimit', f: 'money' }, { l: 'Status', k: 'status', html: r => badge(r.status) }],
    fields: [T('no', 'No.', { req: 1 }), T('name', 'Name', { req: 1, w: 'w2' }), T('tin', 'VAT Registration No. (TIN)', { req: 1 }), T('address', 'Address', { w: 'w2' }), T('city', 'City'),
      T('contact', 'Contact'), T('phone', 'Phone No.'), T('email', 'Email'),
      R('postingGroup', 'Customer Posting Group', 'custPostGroups', { req: 1 }), R('genBus', 'Gen. Bus. Posting Group', 'genBus', { req: 1 }), R('vatBus', 'VAT Bus. Posting Group', 'vatBus', { req: 1 }),
      R('whtBus', 'WHT Bus. Posting Group', 'whtBus'), R('paymentTerms', 'Payment Terms Code', 'paymentTerms'), R('paymentMethod', 'Payment Method Code', 'paymentMethods'),
      R('currency', 'Currency Code (blank = PHP)', 'currencies'), T('creditLimit', 'Credit Limit (LCY)', { t: 'number' }), T('pricesInclVat', 'Prices Including VAT', { t: 'check' }), R('icPartner', 'IC Partner Company (blank = from legal name)', 'companies'),
      T('birCor', 'BIR Certificate of Registration received', { t: 'check' }), T('sampleOR', 'Sample O.R. received', { t: 'check' })] },
  items: { md: 1, title: 'Items', single: 'Item', key: 'no', approval: true, group: 'Inventory',
    desc: 'Item card. Accounts are not on the item: they come from the Gen. Prod. and Inventory Posting Groups through the posting setup.',
    cols: [{ l: 'No.', k: 'no' }, { l: 'Description', k: 'description' }, { l: 'Type', k: 'type' }, { l: 'Base UOM', k: 'uom' }, { l: 'Gen. Prod.', k: 'genProd' }, { l: 'Inv. Posting Group', k: 'invPostGroup' }, { l: 'VAT Prod.', k: 'vatProd' }, { l: 'Unit Cost', k: 'unitCost', f: 'money' }, { l: 'Status', k: 'status', html: r => badge(r.status) }],
    fields: [T('no', 'No.', { req: 1 }), T('description', 'Description', { req: 1, w: 'w2' }), T('type', 'Type', { t: 'select', opts: ['Inventory', 'Non-Inventory', 'Service'], req: 1 }),
      R('uom', 'Base Unit of Measure', 'uom', { req: 1 }), R('category', 'Item Category Code', 'itemCategories'), R('genProd', 'Gen. Prod. Posting Group', 'genProd', { req: 1 }),
      R('invPostGroup', 'Inventory Posting Group', 'invPostGroups'), R('vatProd', 'VAT Prod. Posting Group', 'vatProd', { req: 1 }), R('whtProd', 'WHT Prod. Posting Group', 'whtProd'),
      T('costingMethod', 'Costing Method', { t: 'select', opts: ['FIFO', 'Average', 'Standard', 'Specific', 'LIFO'] }), T('unitCost', 'Unit Cost', { t: 'number' }), T('unitPrice', 'Unit Price', { t: 'number' }),
      T('tracking', 'Item Tracking Code'), T('reorderPoint', 'Reorder Point', { t: 'number' })] },
  accounts: { md: 1, title: 'Chart of Accounts', single: 'G/L Account', key: 'no', group: 'Finance', adminOnly: 'BU Accounting Manager',
    desc: 'G/L accounts for this business unit, including headings and totals.',
    cols: [{ l: 'No.', k: 'no' }, { l: 'Name', k: 'name', html: r => r.type === 'Posting' ? esc(r.name) : `<b>${esc(r.name)}</b>` }, { l: 'Account Type', k: 'type' }, { l: 'Category', k: 'category' }, { l: 'Income/Balance', k: 'incomeBalance' }, { l: 'Gen. Prod.', k: 'genProd' }, { l: 'VAT Prod.', k: 'vatProd' }, { l: 'WHT Prod.', k: 'whtProd' }],
    fields: [T('no', 'No.', { req: 1 }), T('name', 'Name', { req: 1, w: 'w2' }), T('type', 'Account Type', { t: 'select', opts: ACCOUNT_TYPES, req: 1 }), T('category', 'Account Category', { t: 'select', opts: ACCOUNT_CATEGORIES }),
      T('incomeBalance', 'Income/Balance', { t: 'select', opts: ['Balance Sheet', 'Income Statement'], req: 1 }), T('directPosting', 'Direct Posting', { t: 'check' }), T('totaling', 'Totaling'),
      R('genBus', 'Gen. Bus. Posting Group', 'genBus'), R('genProd', 'Gen. Prod. Posting Group', 'genProd'), R('vatBus', 'VAT Bus. Posting Group', 'vatBus'), R('vatProd', 'VAT Prod. Posting Group', 'vatProd'),
      R('whtBus', 'WHT Bus. Posting Group', 'whtBus'), R('whtProd', 'WHT Prod. Posting Group', 'whtProd'), T('blocked', 'Blocked', { t: 'check' })] },
  bankAccounts: { md: 1, title: 'Bank Accounts', single: 'Bank Account', key: 'code', group: 'Finance', companyField: 1,
    cols: [{ l: 'No.', k: 'code' }, { l: 'Name', k: 'name' }, { l: 'Company', k: 'company' }, { l: 'Bank Account No.', k: 'bankAccountNo' }, { l: 'Posting Group', k: 'postingGroup' }, { l: 'Currency', k: 'currency' }],
    fields: [T('code', 'No.', { req: 1 }), T('name', 'Name', { req: 1, w: 'w2' }), R('company', 'Company', 'companies', { req: 1 }), T('bankAccountNo', 'Bank Account No.'),
      R('postingGroup', 'Bank Acc. Posting Group', 'bankPostGroups', { req: 1 }), R('currency', 'Currency Code', 'currencies'), T('nextCheck', 'Last Check No.')] },
  locations: { md: 1, title: 'Locations', single: 'Location', key: 'code', group: 'Inventory',
    desc: 'Warehouses, vessels, mine sites, fuel tanks, equipment and in-transit locations, with their warehouse settings.',
    cols: [{ l: 'Code', k: 'code' }, { l: 'Name', k: 'name' }, { l: 'In-Transit', v: r => r.inTransit ? 'Yes' : '' }, { l: 'Bin Mandatory', v: r => r.binMandatory ? 'Yes' : '' }, { l: 'Require Receive', v: r => r.requireReceive ? 'Yes' : '' }, { l: 'Require Put-away', v: r => r.requirePutaway ? 'Yes' : '' }, { l: 'Bins', v: r => M().bins.filter(b => b.location === r.code).length, num: 1 }],
    fields: [T('code', 'Code', { req: 1 }), T('name', 'Name', { req: 1, w: 'w2' }), T('address', 'Address', { w: 'w2' }), T('city', 'City'), T('inTransit', 'Use As In-Transit', { t: 'check' }),
      T('binMandatory', 'Bin Mandatory', { t: 'check' }), T('requireReceive', 'Require Receive', { t: 'check' }), T('requirePutaway', 'Require Put-away', { t: 'check' }),
      T('requireShipment', 'Require Shipment', { t: 'check' }), T('requirePick', 'Require Pick', { t: 'check' }), T('receiptBin', 'Receipt Bin Code'), T('shipmentBin', 'Shipment Bin Code'), T('adjustmentBin', 'Adjustment Bin Code')] },
  bins: { md: 1, title: 'Bins', single: 'Bin', key: 'location,code', group: 'Inventory', cols: [{ l: 'Location', k: 'location' }, { l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }, { l: 'Zone', k: 'zone' }],
    fields: [R('location', 'Location Code', 'locations', { req: 1 }), T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' }), T('zone', 'Zone Code')] },
  genBus: { md: 1, title: 'Gen. Business Posting Groups', single: 'Gen. Bus. Posting Group', key: 'code', group: 'Posting Setup', cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }, { l: 'Def. VAT Bus.', k: 'defVatBus' }],
    fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' }), R('defVatBus', 'Def. VAT Bus. Posting Group', 'vatBus')] },
  genProd: { md: 1, title: 'Gen. Product Posting Groups', single: 'Gen. Prod. Posting Group', key: 'code', group: 'Posting Setup', cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }], fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' })] },
  genSetup: { md: 1, title: 'General Posting Setup', single: 'General Posting Setup line', key: 'bus,prod', group: 'Posting Setup',
    desc: 'The heart of posting: for each Gen. Bus. × Gen. Prod. combination, the sales, purchase, COGS and inventory adjustment accounts.',
    cols: [{ l: 'Gen. Bus.', k: 'bus' }, { l: 'Gen. Prod.', k: 'prod' }, { l: 'Sales Account', k: 'sales' }, { l: 'Purch. Account', k: 'purch' }, { l: 'COGS Account', k: 'cogs' }, { l: 'Inventory Adjmt.', k: 'invAdj' }, { l: 'Description', k: 'description' }],
    fields: [R('bus', 'Gen. Bus. Posting Group (blank allowed)', 'genBus'), R('prod', 'Gen. Prod. Posting Group', 'genProd', { req: 1 }), A('sales', 'Sales Account'), A('purch', 'Purch. Account'), A('cogs', 'COGS Account'),
      A('invAdj', 'Inventory Adjmt. Account'), A('salesCM', 'Sales Credit Memo Account'), A('purchCM', 'Purch. Credit Memo Account'), A('salesPrepay', 'Sales Prepayments Account'), A('purchPrepay', 'Purch. Prepayments Account'), T('description', 'Description', { w: 'w2' })] },
  invPostGroups: { md: 1, title: 'Inventory Posting Groups', single: 'Inventory Posting Group', key: 'code', group: 'Posting Setup', cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }, { l: 'Inventory Account', k: 'inventory' }],
    fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' }), A('inventory', 'Inventory Account (used when no Inventory Posting Setup line)')] },
  invSetup: { md: 1, title: 'Inventory Posting Setup', single: 'Inventory Posting Setup line', key: 'location,group', group: 'Posting Setup', cols: [{ l: 'Location', k: 'location' }, { l: 'Invt. Posting Group', k: 'group' }, { l: 'Inventory Account', k: 'inventory' }, { l: 'Inventory Account (Interim)', k: 'interim' }],
    fields: [R('location', 'Location Code (blank = all)', 'locations'), R('group', 'Invt. Posting Group Code', 'invPostGroups', { req: 1 }), A('inventory', 'Inventory Account', { req: 1 }), A('interim', 'Inventory Account (Interim)')] },
  vendPostGroups: { md: 1, title: 'Vendor Posting Groups', single: 'Vendor Posting Group', key: 'code', group: 'Posting Setup', cols: [{ l: 'Code', k: 'code' }, { l: 'Payables Account', k: 'payables' }, { l: 'Description', k: 'description' }], fields: [T('code', 'Code', { req: 1 }), A('payables', 'Payables Account', { req: 1 }), T('description', 'Description', { w: 'w2' })] },
  custPostGroups: { md: 1, title: 'Customer Posting Groups', single: 'Customer Posting Group', key: 'code', group: 'Posting Setup', cols: [{ l: 'Code', k: 'code' }, { l: 'Receivables Account', k: 'receivables' }, { l: 'Description', k: 'description' }], fields: [T('code', 'Code', { req: 1 }), A('receivables', 'Receivables Account', { req: 1 }), T('description', 'Description', { w: 'w2' })] },
  bankPostGroups: { md: 1, title: 'Bank Account Posting Groups', single: 'Bank Account Posting Group', key: 'code', group: 'Posting Setup', cols: [{ l: 'Code', k: 'code' }, { l: 'G/L Account No.', k: 'glAccount' }], fields: [T('code', 'Code', { req: 1 }), A('glAccount', 'G/L Account No.', { req: 1 })] },
  vatBus: { md: 1, title: 'VAT Business Posting Groups', single: 'VAT Bus. Posting Group', key: 'code', group: 'VAT & Withholding Tax', cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }], fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' })] },
  vatProd: { md: 1, title: 'VAT Product Posting Groups', single: 'VAT Prod. Posting Group', key: 'code', group: 'VAT & Withholding Tax', cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }], fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' })] },
  vatSetup: { md: 1, title: 'VAT Posting Setup', single: 'VAT Posting Setup line', key: 'bus,prod', group: 'VAT & Withholding Tax',
    cols: [{ l: 'VAT Bus.', k: 'bus' }, { l: 'VAT Prod.', k: 'prod' }, { l: 'Calculation Type', k: 'calcType' }, { l: 'VAT %', k: 'pct', num: 1 }, { l: 'Sales VAT Account', k: 'salesAcc' }, { l: 'Purchase VAT Account', k: 'purchAcc' }],
    fields: [R('bus', 'VAT Bus. Posting Group', 'vatBus', { req: 1 }), R('prod', 'VAT Prod. Posting Group', 'vatProd'), T('calcType', 'VAT Calculation Type', { t: 'select', opts: ['Normal VAT', 'Reverse Charge VAT', 'Full VAT'] }), T('pct', 'VAT %', { t: 'number' }),
      A('salesAcc', 'Sales VAT Account'), A('purchAcc', 'Purchase VAT Account'), A('reverseAcc', 'Reverse Chrg. VAT Acc.')] },
  whtBus: { md: 1, title: 'WHT Business Posting Groups', single: 'WHT Bus. Posting Group', key: 'code', group: 'VAT & Withholding Tax', cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }], fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' })] },
  whtProd: { md: 1, title: 'WHT Product Posting Groups (ATC)', single: 'WHT Prod. Posting Group', key: 'code', group: 'VAT & Withholding Tax', cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }], fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' })] },
  whtSetup: { md: 1, title: 'WHT Posting Setup', single: 'WHT Posting Setup line', key: 'bus,prod', group: 'VAT & Withholding Tax',
    desc: 'Philippine withholding tax. "Invoice" = withheld when the invoice is posted (EWT on purchases). "Payment" = withheld when paid/collected (CWT from customers).',
    cols: [{ l: 'WHT Bus.', k: 'bus' }, { l: 'WHT Prod.', k: 'prod' }, { l: 'WHT %', k: 'pct', num: 1 }, { l: 'Realized', k: 'realized' }, { l: 'Type', k: 'whtType' }, { l: 'Payable WHT Acc.', k: 'payableAcc' }, { l: 'Prepaid (CWT) Acc.', k: 'prepaidAcc' }],
    fields: [R('bus', 'WHT Bus. Posting Group', 'whtBus', { req: 1 }), R('prod', 'WHT Prod. Posting Group', 'whtProd', { req: 1 }), T('pct', 'WHT Percentage', { t: 'number' }), T('realized', 'Realized WHT Type', { t: 'select', opts: ['Invoice', 'Payment'] }),
      T('whtType', 'WHT Type', { t: 'select', opts: ['EWT', 'CWT', 'FWT'] }), A('payableAcc', 'Payable WHT Account'), A('prepaidAcc', 'Prepaid / Creditable WHT Account')] },
  dimensions: { md: 1, title: 'Dimensions', single: 'Dimension', key: 'code', group: 'Finance', cols: [{ l: 'Code', k: 'code' }, { l: 'Name', k: 'name' }, { l: 'Values', v: r => M().dimValues.filter(v => v.dim === r.code).length, num: 1 }], fields: [T('code', 'Code', { req: 1 }), T('name', 'Name', { w: 'w2' })] },
  dimValues: { md: 1, title: 'Dimension Values', single: 'Dimension Value', key: 'dim,code', group: 'Finance', cols: [{ l: 'Dimension', k: 'dim' }, { l: 'Code', k: 'code' }, { l: 'Name', k: 'name' }, { l: 'Type', k: 'type' }],
    fields: [R('dim', 'Dimension Code', 'dimensions', { req: 1 }), T('code', 'Code', { req: 1 }), T('name', 'Name', { w: 'w2' }), T('type', 'Dimension Value Type', { t: 'select', opts: ['Standard', 'Heading', 'Total', 'Begin-Total', 'End-Total'] })] },
  paymentTerms: { md: 1, title: 'Payment Terms', single: 'Payment Terms', key: 'code', group: 'Finance', cols: [{ l: 'Code', k: 'code' }, { l: 'Due Date Calculation', k: 'dueCalc' }, { l: 'Days', k: 'days', num: 1 }, { l: 'Description', k: 'description' }],
    fields: [T('code', 'Code', { req: 1 }), T('dueCalc', 'Due Date Calculation'), T('days', 'Days', { t: 'number' }), T('description', 'Description', { w: 'w2' })] },
  paymentMethods: { md: 1, title: 'Payment Methods', single: 'Payment Method', key: 'code', group: 'Finance', cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }], fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' })] },
  currencies: { md: 1, title: 'Currencies', single: 'Currency', key: 'code', group: 'Finance', cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }], fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' })] },
  uom: { md: 1, title: 'Units of Measure', single: 'Unit of Measure', key: 'code', group: 'Inventory', cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }], fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' })] },
  itemCategories: { md: 1, title: 'Item Categories', single: 'Item Category', key: 'code', group: 'Inventory', cols: [{ l: 'Code', k: 'code' }, { l: 'Parent', k: 'parent' }, { l: 'Description', k: 'description' }], fields: [T('code', 'Code', { req: 1 }), T('parent', 'Parent Category'), T('description', 'Description', { w: 'w2' })] },
  itemCharges: { md: 1, title: 'Item Charges', single: 'Item Charge', key: 'no', group: 'Inventory', desc: 'Freight, duties, brokerage etc. Assigned to items on a purchase invoice to build landed cost.',
    cols: [{ l: 'No.', k: 'no' }, { l: 'Description', k: 'description' }, { l: 'Gen. Prod.', k: 'genProd' }, { l: 'VAT Prod.', k: 'vatProd' }, { l: 'WHT Prod.', k: 'whtProd' }],
    fields: [T('no', 'No.', { req: 1 }), T('description', 'Description', { w: 'w2' }), R('genProd', 'Gen. Prod. Posting Group', 'genProd', { req: 1 }), R('vatProd', 'VAT Prod. Posting Group', 'vatProd'), R('whtProd', 'WHT Prod. Posting Group', 'whtProd')] },
  noSeries: { md: 1, title: 'No. Series', single: 'No. Series', key: 'code', group: 'Finance', cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }, { l: 'Starting No.', v: r => (M().noSeriesLines.find(l => l.series === r.code) || {}).startNo }, { l: 'Last No. Used', v: r => (M().noSeriesLines.find(l => l.series === r.code) || {}).lastUsed }],
    fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' })] },
  journalBatches: { md: 1, title: 'Journal Batches', single: 'Journal Batch', key: 'template,name', group: 'Finance', cols: [{ l: 'Template', k: 'template' }, { l: 'Batch', k: 'name' }, { l: 'Description', k: 'description' }, { l: 'Bal. Account Type', k: 'balAccType' }, { l: 'Bal. Account No.', k: 'balAccNo' }, { l: 'No. Series', k: 'noSeries' }],
    fields: [T('template', 'Journal Template Name', { req: 1 }), T('name', 'Name', { req: 1 }), T('description', 'Description', { w: 'w2' }), T('balAccType', 'Bal. Account Type'), T('balAccNo', 'Bal. Account No.'), T('noSeries', 'No. Series')] },
  faClasses: { md: 1, title: 'FA Classes', single: 'FA Class', key: 'code', group: 'Fixed Assets', cols: [{ l: 'Code', k: 'code' }, { l: 'Name', k: 'name' }], fields: [T('code', 'Code', { req: 1 }), T('name', 'Name', { w: 'w2' })] },
  faSubclasses: { md: 1, title: 'FA Subclasses', single: 'FA Subclass', key: 'code', group: 'Fixed Assets', cols: [{ l: 'Code', k: 'code' }, { l: 'Name', k: 'name' }, { l: 'FA Class', k: 'classCode' }, { l: 'Default FA Posting Group', k: 'defPostGroup' }],
    fields: [T('code', 'Code', { req: 1 }), T('name', 'Name', { w: 'w2' }), R('classCode', 'FA Class Code', 'faClasses'), R('defPostGroup', 'Default FA Posting Group', 'faPostGroups')] },
  faLocations: { md: 1, title: 'FA Locations', single: 'FA Location', key: 'code', group: 'Fixed Assets', cols: [{ l: 'Code', k: 'code' }, { l: 'Name', k: 'name' }], fields: [T('code', 'Code', { req: 1 }), T('name', 'Name', { w: 'w2' })] },
  faPostGroups: { md: 1, title: 'FA Posting Groups', single: 'FA Posting Group', key: 'code', group: 'Fixed Assets',
    cols: [{ l: 'Code', k: 'code' }, { l: 'Description', k: 'description' }, { l: 'Acquisition Cost', k: 'acqCost' }, { l: 'Accum. Depreciation', k: 'accumDep' }, { l: 'Depreciation Expense', k: 'depExp' }, { l: 'Gains', k: 'gains' }, { l: 'Losses', k: 'losses' }],
    fields: [T('code', 'Code', { req: 1 }), T('description', 'Description', { w: 'w2' }), A('acqCost', 'Acquisition Cost Account', { req: 1 }), A('accumDep', 'Accum. Depreciation Account'), A('depExp', 'Depreciation Expense Acc.'),
      A('acqCostDisp', 'Acq. Cost Acc. on Disposal'), A('accumDepDisp', 'Accum. Depr. Acc. on Disposal'), A('gains', 'Gains Acc. on Disposal'), A('losses', 'Losses Acc. on Disposal'), A('maintExp', 'Maintenance Expense Account')] },
  employees: { md: 1, title: 'Employees', single: 'Employee', key: 'no', group: 'Fixed Assets', desc: 'Only name and job title are kept here (personal data such as birth dates and SSS numbers is not imported).',
    cols: [{ l: 'No.', k: 'no' }, { l: 'First Name', k: 'firstName' }, { l: 'Last Name', k: 'lastName' }, { l: 'Job Title', k: 'jobTitle' }],
    fields: [T('no', 'No.', { req: 1 }), T('firstName', 'First Name', { req: 1 }), T('lastName', 'Last Name'), T('jobTitle', 'Job Title'), T('postingGroup', 'Employee Posting Group')] },
  companies: { title: 'Companies', single: 'Company', key: 'code', group: 'Administration', adminOnly: 'System Admin',
    desc: 'Each company uses the Master Data Set (chart of accounts and setup) of its business unit. LLRI and LAMI share the Mining set.',
    cols: [{ l: 'Code', k: 'code' }, { l: 'Name', k: 'name' }, { l: 'Legal Name', k: 'legalName' }, { l: 'Business Unit', k: 'bu' }, { l: 'Master Data Set', k: 'md' }, { l: 'TIN', k: 'tin' }],
    fields: [T('code', 'Code', { req: 1 }), T('name', 'Name', { req: 1, w: 'w2' }), T('bu', 'Business Unit', { t: 'select', opts: ['Admin / Corporate', 'Land', 'Mining', 'Tankering / Shipping', 'Port'], req: 1 }),
      { k: 'md', l: 'Master Data Set', t: 'select', get opts() { return Object.keys(DB.md); }, req: 1 }, T('legalName', 'Legal Name (identifies it as IC partner)', { w: 'w2' }), T('tin', 'TIN'), T('address', 'Address', { w: 'w2' })] },
  users: { title: 'Users & Roles', single: 'User', key: 'id', group: 'Administration', adminOnly: 'System Admin',
    desc: 'Each user holds one or more roles. Approval steps are assigned to roles. Nobody can approve a document they created.',
    cols: [{ l: 'ID', k: 'id' }, { l: 'Name', k: 'name' }, { l: 'Roles', v: r => (r.roles || []).join(', ') }],
    fields: [T('id', 'User ID', { req: 1 }), T('name', 'Name', { req: 1 }), T('email', 'Email'), { k: 'roles', l: 'Roles', t: 'multi', opts: ROLES, w: 'w3' }] },
  budgets: { title: 'Budgets', single: 'Budget Line', key: 'id', group: 'Finance', companyScoped: true, adminOnly: 'BU Accounting Manager',
    desc: 'Annual budget per company and G/L account. Used for approval routing when Budget Control is switched on in Settings.',
    cols: [{ l: 'Company', k: 'company' }, { l: 'Year', k: 'year' }, { l: 'Account', k: 'account' }, { l: 'Account Name', v: r => accName(r.account, r.company) }, { l: 'Budget', k: 'amount', f: 'money' }],
    fields: [R('company', 'Company', 'companies', { req: 1 }), T('year', 'Year', { req: 1 }), A('account', 'G/L Account', { req: 1, w: 'w2' }), T('amount', 'Annual Budget', { t: 'number', req: 1 })] },
  approvalRules: { title: 'Approval Rules', single: 'Approval Step', key: 'id', group: 'Administration', adminOnly: 'System Admin',
    desc: 'Approval chains from the signed To-Be process flows. Steps run in sequence; a step is skipped when its condition does not apply.',
    cols: [{ l: 'Document', k: 'docType', v: r => `${r.docType} – ${(DOCS[r.docType] || { name: 'Master Data cards' }).name}` }, { l: 'Seq', k: 'seq', num: 1 }, { l: 'Approver Role', k: 'role' },
      { l: 'Condition', v: r => (APPROVAL_CONDITIONS.find(c => c[0] === r.cond) || [, r.cond])[1] + (r.cond === 'amountGte' ? ` (${money(r.amount)})` : '') }],
    fields: [T('docType', 'Document Type', { t: 'select', opts: DOC_TYPES_FOR_RULES, req: 1 }), T('seq', 'Sequence', { t: 'number', req: 1 }), T('role', 'Approver Role', { t: 'select', opts: ROLES, req: 1 }),
      T('cond', 'Condition', { t: 'select', opts: APPROVAL_CONDITIONS, req: 1, w: 'w2' }), T('amount', 'Amount threshold (for "amount ≥")', { t: 'number' })] }
};
const masterColl = coll => MASTERS[coll].md ? M()[coll] : DB[coll];
const masterKey = (def, r) => def.key.split(',').map(k => r[k] ?? '').join('~');

/* ---------- Seed: companies, users, approval rules + the BC master packages ---------- */
async function buildSeedDB() {
  const yr = today().slice(0, 4);
  let md = {};
  try { const r = await fetch('seed/masters.json', { cache: 'no-store' }); if (r.ok) md = await r.json(); } catch (e) { /* no bundled masters */ }
  if (!Object.keys(md).length) md = { LAND: emptyMD('Land'), MINING: emptyMD('Mining'), TANK: emptyMD('Tankering') };
  return {
    meta: { seq: {}, created: new Date().toISOString(), version: 2, rev: 0 },
    settings: { groupName: 'Leonio Group', postingFrom: `${yr}-01-01`, postingTo: `${yr}-12-31`, budgetControl: false },
    md,
    companies: [
      { code: 'ADMIN', name: 'Admin / Shared Services', bu: 'Admin / Corporate', md: 'MINING', tin: '', address: '' },
      { code: 'LAND', name: 'Land', bu: 'Land', md: 'LAND', tin: '', address: '' },
      { code: 'LLRI', name: 'Mining – LLRI', bu: 'Mining', md: 'MINING', tin: '', address: '' },
      { code: 'LAMI', name: 'Mining – LAMI', bu: 'Mining', md: 'MINING', tin: '', address: '' },
      { code: 'TANK', name: 'Tankering', bu: 'Tankering / Shipping', md: 'TANK', tin: '', address: '' }
    ],
    users: [
      ['u01', 'System Administrator', ['System Admin']], ['u02', 'Requester (Technical)', ['Requester']], ['u03', 'Department Head', ['Department Head']],
      ['u04', 'Purchasing Assistant', ['Purchasing Assistant', 'Supply Chain Specialist']], ['u05', 'Supply Chain & Admin Head', ['Supply Chain & Admin Head']],
      ['u06', 'Warehouseman', ['Warehouseman']], ['u07', 'AP Accounting Associate', ['AP Accounting Associate']], ['u08', 'General Accounting Supervisor', ['General Accounting Supervisor']],
      ['u09', 'Executive Assistant to the President', ['Executive Assistant to the President']], ['u10', 'Special Assistant to the President', ['Special Assistant to the President']],
      ['u11', 'Commercial Manager', ['Commercial Manager']], ['u12', 'President', ['President']], ['u13', 'Accounting Manager - Shared Service', ['Accounting Manager - Shared Service']],
      ['u14', 'BU Accounting Manager', ['BU Accounting Manager', 'G/L Accountant']], ['u15', 'Treasury Supervisor', ['Treasury Supervisor']],
      ['u16', 'Treasury Assistant Manager', ['Treasury Assistant Manager']], ['u17', 'Billing / Sales Associate', ['Billing / Sales Associate']], ['u18', 'ICT Head', ['ICT Head']]
    ].map(([id, name, roles]) => ({ id, name, roles, email: '' })),
    approvalRules: [
      ['PR', 10, 'Department Head', 'always'], ['PQ', 10, 'Executive Assistant to the President', 'always'], ['PQ', 20, 'Commercial Manager', 'outsideBudget'],
      ['PO', 10, 'Supply Chain & Admin Head', 'always'], ['PI', 10, 'General Accounting Supervisor', 'always'], ['PI', 20, 'Executive Assistant to the President', 'notGa'],
      ['PI', 30, 'Special Assistant to the President', 'ga'], ['PI', 40, 'President', 'capexOrOutside'], ['PI', 50, 'Accounting Manager - Shared Service', 'always'],
      ['PRET', 10, 'Accounting Manager - Shared Service', 'always'], ['PAY', 10, 'Treasury Supervisor', 'always'], ['PAY', 20, 'Treasury Assistant Manager', 'always'],
      ['PAY', 30, 'President', 'amountGte', 1000000], ['SI', 10, 'Accounting Manager - Shared Service', 'always'], ['SCM', 10, 'Accounting Manager - Shared Service', 'always'],
      ['CR', 10, 'Treasury Assistant Manager', 'always'], ['IJ', 10, 'BU Accounting Manager', 'always'], ['PC', 10, 'BU Accounting Manager', 'always'],
      ['GJ', 10, 'BU Accounting Manager', 'always'], ['MASTER', 10, 'ICT Head', 'always'], ['MASTER', 20, 'Accounting Manager - Shared Service', 'always']
    ].map(([docType, seq, role, cond, amount]) => ({ id: uid(), docType, seq, role, cond, amount: amount || 0 })),
    budgets: [], docs: [], gl: [], itemLedger: [], apLedger: [], arLedger: [], faLedger: [], audit: []
  };
}
