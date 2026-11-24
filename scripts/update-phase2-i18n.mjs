import fs from 'fs';

function updateJson(filePath, updater) {
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  updater(content);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf8');
  console.log(`Updated ${filePath}`);
}

// 1. Finance Locales
const enFinanceSales = {
  tabs: {
    forecast: "7-Day Dual Forecast",
    history: "Forecast vs. Actuals",
    import: "Petpooja Import",
  },
  loadingForecast: "Calculating dual-track sales predictions...",
  dualTrackEngine: "Dual-Track Self-Learning Engine",
  trainedOnWeeks: "Trained on {count} weeks of live history",
  forecastSubtitle: "Independent Quantity and Revenue models with dynamic bill classification & event decomposition.",
  confidenceGuide: "Confidence Guide",
  planEventOrGroup: "Plan Event / Group",
  sevenDayOutlook: "7-Day Rolling Sales Outlook",
  tapToInspect: "Tap any date to inspect details",
  today: "Today",
  tomorrow: "Tomorrow",
  units: "units",
  editContext: "Modify Day Context",
  track1Revenue: "Track 1: Revenue Space",
  confidence: "Confidence",
  expectedRange: "Expected Range",
  impliedGross: "Predicted Gross",
  expectedDiscounts: "Expected Discounts",
  additiveGroupRevenue: "Additive Group Demand",
  track2Quantity: "Track 2: Quantity Space",
  dishUnits: "dish units",
  expectedDemand: "Expected Footfall",
  covers: "covers",
  bills: "bills",
  topDishesVolume: "Volume in Mapped Recipes",
  bomReadiness: "BOM Purchasing Link",
  readyForExplosion: "Ready for Explosion",
  additiveGroupUnits: "Group Units",
  yesterdayScorecard: "Yesterday's Graded Scorecard",
  revenueAccuracy: "Revenue Realized",
  volumeAccuracy: "Volume Consumed",
  topDishesForecast: "Top Predicted Dishes",
  sortedByVolume: "Ranked by volume demand",
  dishName: "Dish Name",
  predictedUnits: "Predicted Units",
  avgPrice: "Avg Selling Price",
  impliedSales: "Implied Sales",
  share: "Volume Share",
  planEventModalTitle: "Plan Special Event / Group Booking",
  date: "Business Date",
  dayMode: "Day Mode",
  modeNormal: "Normal Operations",
  modeSpecialEvent: "Special Event / Festival",
  modeGroupBooking: "Large Group Booking",
  modeHybrid: "Hybrid (Event + Group)",
  eventType: "Event Type",
  selectEventType: "-- Select Event --",
  expectedGuests: "Expected Guests (PAX)",
  groupType: "Group Category",
  notes: "Booking Notes / Details",
  confidenceGuideTitle: "Understanding Dual-Track Confidence",
  loadingHistory: "Loading historical predictions & bill classifications...",
  walkForwardReplay: "82-Day Walk-Forward Replay",
  gradedDates: "graded dates",
  historyTitle: "Forecast vs. Actual Intelligence & Demand Decomposition",
  revenueWape: "Rev WAPE",
  dishWape: "Dish WAPE",
  normalWalkIn: "Normal Walk-In Sales",
  largeGroups: "Large Groups Demand",
  highValueAnomalies: "High Value Anomalies",
  outsideActivities: "Outside Village Activities",
  selectDate: "Historical Dates",
  whyDayHappened: "Why This Day Happened",
  predicted: "Predicted",
  normal: "Normal",
  largeGroup: "Large Group",
  highValue: "High Value",
  activities: "Outside Act.",
  complimentary: "Complimentary",
  classifiedBills: "Classified Transactions",
};

const hiFinanceSales = {
  tabs: {
    forecast: "7-दिवसीय दोहरा पूर्वानुमान",
    history: "पूर्वानुमान बनाम वास्तविक",
    import: "पेटपूजा आयात",
  },
  loadingForecast: "दोहरे-ट्रैक बिक्री पूर्वानुमान की गणना की जा रही है...",
  dualTrackEngine: "दोहरा-ट्रैक स्व-शिक्षण इंजन",
  trainedOnWeeks: "लाइव इतिहास के {count} सप्ताहों पर प्रशिक्षित",
  forecastSubtitle: "गतिशील बिल वर्गीकरण और आयोजन अपघटन के साथ स्वतंत्र मात्रा और राजस्व मॉडल।",
  confidenceGuide: "सटीकता व विश्वास गाइड",
  planEventOrGroup: "आयोजन / ग्रुप प्लान करें",
  sevenDayOutlook: "7-दिवसीय बिक्री आउटलुक",
  tapToInspect: "विवरण देखने के लिए किसी भी तिथि पर टैप करें",
  today: "आज",
  tomorrow: "कल",
  units: "यूनिट",
  editContext: "दिवस संदर्भ संपादित करें",
  track1Revenue: "ट्रैक 1: राजस्व दायरा",
  confidence: "सटीकता",
  expectedRange: "अनुमानित दायरा",
  impliedGross: "पूर्वानुमानित सकल",
  expectedDiscounts: "अपेक्षित छूट",
  additiveGroupRevenue: "अतिरिक्त ग्रुप मांग",
  track2Quantity: "ट्रैक 2: मात्रा दायरा",
  dishUnits: "व्यंजन प्लेटें",
  expectedDemand: "अपेक्षित फुटफॉल",
  covers: "आने वाले लोग",
  bills: "बिल",
  topDishesVolume: "मैप की गई रेसिपी मात्रा",
  bomReadiness: "बीओएम खरीद लिंक",
  readyForExplosion: "एक्सप्लोजन के लिए तैयार",
  additiveGroupUnits: "ग्रुप यूनिट",
  yesterdayScorecard: "कल का मूल्यांकित स्कोरकार्ड",
  revenueAccuracy: "वास्तविक राजस्व",
  volumeAccuracy: "खपत मात्रा",
  topDishesForecast: "शीर्ष पूर्वानुमानित व्यंजन",
  sortedByVolume: "मात्रा मांग अनुसार क्रमित",
  dishName: "व्यंजन का नाम",
  predictedUnits: "पूर्वानुमानित यूनिट",
  avgPrice: "औसत बिक्री मूल्य",
  impliedSales: "अनुमानित बिक्री",
  share: "मात्रा हिस्सेदारी",
  planEventModalTitle: "विशेष आयोजन / बड़ा ग्रुप प्लान करें",
  date: "कारोबारी तिथि",
  dayMode: "दिवस मोड",
  modeNormal: "सामान्य संचालन",
  modeSpecialEvent: "विशेष आयोजन / उत्सव",
  modeGroupBooking: "बड़ा ग्रुप बुकिंग",
  modeHybrid: "हाइब्रिड (आयोजन + ग्रुप)",
  eventType: "आयोजन प्रकार",
  selectEventType: "-- आयोजन चुनें --",
  expectedGuests: "अपेक्षित मेहमान (PAX)",
  groupType: "ग्रुप श्रेणी",
  notes: "बुकिंग विवरण / नोट्स",
  confidenceGuideTitle: "दोहरे-ट्रैक सटीकता को समझना",
  loadingHistory: "ऐतिहासिक पूर्वानुमान और बिल वर्गीकरण लोड हो रहा है...",
  walkForwardReplay: "82-दिवसीय वॉक-फॉरवर्ड रीप्ले",
  gradedDates: "मूल्यांकित तिथियां",
  historyTitle: "पूर्वानुमान बनाम वास्तविक विश्लेषण एवं मांग अपघटन",
  revenueWape: "राजस्व WAPE",
  dishWape: "व्यंजन WAPE",
  normalWalkIn: "सामान्य वॉक-इन बिक्री",
  largeGroups: "बड़े ग्रुप की मांग",
  highValueAnomalies: "उच्च मूल्य विसंगतियां",
  outsideActivities: "बाहरी गाँव गतिविधियाँ",
  selectDate: "ऐतिहासिक तिथियां",
  whyDayHappened: "यह दिन ऐसा क्यों रहा",
  predicted: "पूर्वानुमानित",
  normal: "सामान्य",
  largeGroup: "बड़ा ग्रुप",
  highValue: "उच्च मूल्य",
  activities: "बाहरी गतिविधियाँ",
  complimentary: "कॉम्प्लिमेंट्री",
  classifiedBills: "वर्गीकृत लेन-देन",
};

updateJson('src/locales/en/finance.json', (en) => {
  en.sales = { ...en.sales, ...enFinanceSales };
});

updateJson('src/locales/hi/finance.json', (hi) => {
  hi.sales = { ...hi.sales, ...hiFinanceSales };
});

// 2. Inventory Locales
const enInventoryVariance = {
  title: "Theoretical vs. Actual (Theo-vs-Act) Variance Tracker",
  subtitle: "Recipe BOM consumption compared against recorded store movements and stock counts.",
  restrictedTitle: "Costing & Variance Access Restricted",
  restrictedDesc: "Theoretical vs. Actual Variance contains confidential recipe costing and WAC valuations. Accessible exclusively to Managers, Costing Accountants, and Administrators.",
  totalItems: "Evaluated Items",
  unfavorable: "Unfavorable Variance",
  favorable: "Favorable Variance",
  netCostVariance: "Net Cost Variance",
};

const hiInventoryVariance = {
  title: "सैद्धांतिक बनाम वास्तविक (Theo-vs-Act) स्टॉक अंतर ट्रैकर",
  subtitle: "दर्ज स्टोर निकासी एवं स्टॉक गणना के मुकाबले रेसिपी बीओएम खपत की तुलना।",
  restrictedTitle: "लागत एवं अंतर पहुंच प्रतिबंधित",
  restrictedDesc: "सैद्धांतिक बनाम वास्तविक अंतर में गोपनीय रेसिपी लागत और WAC मूल्यांकन शामिल हैं। केवल प्रबंधकों, लागत लेखाकारों और प्रशासकों के लिए सुलभ।",
  totalItems: "मूल्यांकित वस्तुएं",
  unfavorable: "प्रतिकूल अंतर",
  favorable: "अनुकूल अंतर",
  netCostVariance: "शुद्ध लागत अंतर",
};

updateJson('src/locales/en/inventory.json', (en) => {
  if (!en.stock) en.stock = {};
  if (!en.stock.topTabs) en.stock.topTabs = {};
  en.stock.topTabs.variance = "Theo-vs-Act Variance";
  en.variance = enInventoryVariance;
});

updateJson('src/locales/hi/inventory.json', (hi) => {
  if (!hi.stock) hi.stock = {};
  if (!hi.stock.topTabs) hi.stock.topTabs = {};
  hi.stock.topTabs.variance = "सैद्धांतिक बनाम वास्तविक अंतर";
  hi.variance = hiInventoryVariance;
});

// 3. Dashboard Locales
const enDashboardSalesOutlook = {
  title: "Sales Outlook & Dual-Track Pace",
  loading: "Loading sales outlook...",
  predictedNet: "Predicted Net Sales",
  predictedUnits: "Predicted Plates & Volume",
  viewRibbon: "View 7-Day Forecast",
};

const hiDashboardSalesOutlook = {
  title: "बिक्री आउटलुक एवं दोहरा-ट्रैक पेस",
  loading: "बिक्री आउटलुक लोड हो रहा है...",
  predictedNet: "पूर्वानुमानित शुद्ध बिक्री",
  predictedUnits: "पूर्वानुमानित प्लेटें एवं मात्रा",
  viewRibbon: "7-दिवसीय पूर्वानुमान देखें",
};

updateJson('src/locales/en/dashboard.json', (en) => {
  en.salesOutlook = enDashboardSalesOutlook;
});

updateJson('src/locales/hi/dashboard.json', (hi) => {
  hi.salesOutlook = hiDashboardSalesOutlook;
});
