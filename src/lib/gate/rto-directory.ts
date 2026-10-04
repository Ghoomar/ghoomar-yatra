/**
 * Authoritative Indian Vehicle Registration Prefix (RTO) Reference Directory
 *
 * Provides deterministic mapping of Indian RTO codes to their canonical
 * location name, district, and state.
 * Used exclusively for administrative suggestions and autofill in the Prefix Master.
 */

export interface RtoLocationEntry {
  locationName: string;
  nameHi?: string;
  district?: string;
  state: string;
}

export const STATE_PREFIX_MAP: Record<string, string> = {
  UP: 'Uttar Pradesh',
  DL: 'Delhi',
  HR: 'Haryana',
  UK: 'Uttarakhand',
  UA: 'Uttarakhand',
  RJ: 'Rajasthan',
  MP: 'Madhya Pradesh',
  JH: 'Jharkhand',
  BR: 'Bihar',
  PB: 'Punjab',
  CH: 'Chandigarh',
  HP: 'Himachal Pradesh',
  GJ: 'Gujarat',
  MH: 'Maharashtra',
  AP: 'Andhra Pradesh',
  AR: 'Arunachal Pradesh',
  AS: 'Assam',
  CG: 'Chhattisgarh',
  GA: 'Goa',
  JK: 'Jammu and Kashmir',
  KA: 'Karnataka',
  KL: 'Kerala',
  LA: 'Ladakh',
  ML: 'Meghalaya',
  MN: 'Manipur',
  MZ: 'Mizoram',
  NL: 'Nagaland',
  OD: 'Odisha',
  OR: 'Odisha',
  PY: 'Puducherry',
  SK: 'Sikkim',
  TN: 'Tamil Nadu',
  TR: 'Tripura',
  TS: 'Telangana',
  WB: 'West Bengal',
  BH: 'Bharat Series',
};

export const RTO_DIRECTORY: Record<string, RtoLocationEntry> = {
  // =========================================================================
  // UTTAR PRADESH (UP)
  // =========================================================================
  UP11: { locationName: 'Saharanpur', nameHi: 'सहारनपुर', district: 'Saharanpur', state: 'Uttar Pradesh' },
  UP12: { locationName: 'Muzaffarnagar', nameHi: 'मुज़फ्फरनगर', district: 'Muzaffarnagar', state: 'Uttar Pradesh' },
  UP13: { locationName: 'Bulandshahr', nameHi: 'बुलंदशहर', district: 'Bulandshahr', state: 'Uttar Pradesh' },
  UP14: { locationName: 'Ghaziabad', nameHi: 'गाजियाबाद', district: 'Ghaziabad', state: 'Uttar Pradesh' },
  UP15: { locationName: 'Meerut', nameHi: 'मेरठ', district: 'Meerut', state: 'Uttar Pradesh' },
  UP16: { locationName: 'Noida', nameHi: 'नोएडा', district: 'Gautam Buddha Nagar', state: 'Uttar Pradesh' },
  UP17: { locationName: 'Baghpat', nameHi: 'बागपत', district: 'Baghpat', state: 'Uttar Pradesh' },
  UP19: { locationName: 'Shamli', nameHi: 'शामली', district: 'Shamli', state: 'Uttar Pradesh' },
  UP20: { locationName: 'Bijnor', nameHi: 'बिजनौर', district: 'Bijnor', state: 'Uttar Pradesh' },
  UP21: { locationName: 'Moradabad', nameHi: 'मुरादाबाद', district: 'Moradabad', state: 'Uttar Pradesh' },
  UP22: { locationName: 'Rampur', nameHi: 'रामपुर', district: 'Rampur', state: 'Uttar Pradesh' },
  UP23: { locationName: 'Amroha', nameHi: 'अमरोहा', district: 'Amroha', state: 'Uttar Pradesh' },
  UP24: { locationName: 'Budaun', nameHi: 'बदायूं', district: 'Budaun', state: 'Uttar Pradesh' },
  UP25: { locationName: 'Bareilly', nameHi: 'बरेली', district: 'Bareilly', state: 'Uttar Pradesh' },
  UP26: { locationName: 'Pilibhit', nameHi: 'पीलीभीत', district: 'Pilibhit', state: 'Uttar Pradesh' },
  UP27: { locationName: 'Shahjahanpur', nameHi: 'शाहजहांपुर', district: 'Shahjahanpur', state: 'Uttar Pradesh' },
  UP30: { locationName: 'Hardoi', nameHi: 'हरदोई', district: 'Hardoi', state: 'Uttar Pradesh' },
  UP31: { locationName: 'Lakhimpur', nameHi: 'लखीमपुर खीरी', district: 'Kheri', state: 'Uttar Pradesh' },
  UP32: { locationName: 'Lucknow', nameHi: 'लखनऊ', district: 'Lucknow', state: 'Uttar Pradesh' },
  UP33: { locationName: 'Raebareli', nameHi: 'रायबरेली', district: 'Raebareli', state: 'Uttar Pradesh' },
  UP34: { locationName: 'Sitapur', nameHi: 'सीतापुर', district: 'Sitapur', state: 'Uttar Pradesh' },
  UP35: { locationName: 'Unnao', nameHi: 'उन्नाव', district: 'Unnao', state: 'Uttar Pradesh' },
  UP36: { locationName: 'Amethi', nameHi: 'अमेठी', district: 'Amethi', state: 'Uttar Pradesh' },
  UP37: { locationName: 'Hapur', nameHi: 'हापुड़', district: 'Hapur', state: 'Uttar Pradesh' },
  UP38: { locationName: 'Sambhal', nameHi: 'संभल', district: 'Sambhal', state: 'Uttar Pradesh' },
  UP40: { locationName: 'Bahraich', nameHi: 'बहराइच', district: 'Bahraich', state: 'Uttar Pradesh' },
  UP41: { locationName: 'Barabanki', nameHi: 'बाराबंकी', district: 'Barabanki', state: 'Uttar Pradesh' },
  UP42: { locationName: 'Ayodhya', nameHi: 'अयोध्या', district: 'Ayodhya', state: 'Uttar Pradesh' },
  UP43: { locationName: 'Gonda', nameHi: 'गोंडा', district: 'Gonda', state: 'Uttar Pradesh' },
  UP44: { locationName: 'Sultanpur', nameHi: 'सुल्तानपुर', district: 'Sultanpur', state: 'Uttar Pradesh' },
  UP45: { locationName: 'Ambedkar Nagar', nameHi: 'अंबेडकर नगर', district: 'Ambedkar Nagar', state: 'Uttar Pradesh' },
  UP46: { locationName: 'Shravasti', nameHi: 'श्रावस्ती', district: 'Shravasti', state: 'Uttar Pradesh' },
  UP47: { locationName: 'Balrampur', nameHi: 'बलरामपुर', district: 'Balrampur', state: 'Uttar Pradesh' },
  UP50: { locationName: 'Azamgarh', nameHi: 'आज़मगढ़', district: 'Azamgarh', state: 'Uttar Pradesh' },
  UP51: { locationName: 'Basti', nameHi: 'बस्ती', district: 'Basti', state: 'Uttar Pradesh' },
  UP52: { locationName: 'Deoria', nameHi: 'देवरिया', district: 'Deoria', state: 'Uttar Pradesh' },
  UP53: { locationName: 'Gorakhpur', nameHi: 'गोरखपुर', district: 'Gorakhpur', state: 'Uttar Pradesh' },
  UP54: { locationName: 'Mau', nameHi: 'मऊ', district: 'Mau', state: 'Uttar Pradesh' },
  UP55: { locationName: 'Siddharthnagar', nameHi: 'सिद्धार्थनगर', district: 'Siddharthnagar', state: 'Uttar Pradesh' },
  UP56: { locationName: 'Maharajganj', nameHi: 'महराजगंज', district: 'Maharajganj', state: 'Uttar Pradesh' },
  UP57: { locationName: 'Kushinagar', nameHi: 'कुशीनगर', district: 'Kushinagar', state: 'Uttar Pradesh' },
  UP58: { locationName: 'Sant Kabir Nagar', nameHi: 'संत कबीर नगर', district: 'Sant Kabir Nagar', state: 'Uttar Pradesh' },
  UP60: { locationName: 'Ballia', nameHi: 'बलिया', district: 'Ballia', state: 'Uttar Pradesh' },
  UP61: { locationName: 'Ghazipur', nameHi: 'गाज़ीपुर', district: 'Ghazipur', state: 'Uttar Pradesh' },
  UP62: { locationName: 'Jaunpur', nameHi: 'जौनपुर', district: 'Jaunpur', state: 'Uttar Pradesh' },
  UP63: { locationName: 'Mirzapur', nameHi: 'मिर्ज़ापुर', district: 'Mirzapur', state: 'Uttar Pradesh' },
  UP64: { locationName: 'Sonbhadra', nameHi: 'सोनभद्र', district: 'Sonbhadra', state: 'Uttar Pradesh' },
  UP65: { locationName: 'Varanasi', nameHi: 'वाराणसी', district: 'Varanasi', state: 'Uttar Pradesh' },
  UP66: { locationName: 'Bhadohi', nameHi: 'भदोही', district: 'Bhadohi', state: 'Uttar Pradesh' },
  UP67: { locationName: 'Chandauli', nameHi: 'चंदौली', district: 'Chandauli', state: 'Uttar Pradesh' },
  UP70: { locationName: 'Prayagraj', nameHi: 'प्रयागराज', district: 'Prayagraj', state: 'Uttar Pradesh' },
  UP71: { locationName: 'Fatehpur', nameHi: 'फ़तेहपुर', district: 'Fatehpur', state: 'Uttar Pradesh' },
  UP72: { locationName: 'Pratapgarh', nameHi: 'प्रतापगढ़', district: 'Pratapgarh', state: 'Uttar Pradesh' },
  UP73: { locationName: 'Kaushambi', nameHi: 'कौशाम्बी', district: 'Kaushambi', state: 'Uttar Pradesh' },
  UP74: { locationName: 'Kannauj', nameHi: 'कन्नौज', district: 'Kannauj', state: 'Uttar Pradesh' },
  UP75: { locationName: 'Etawah', nameHi: 'इटावा', district: 'Etawah', state: 'Uttar Pradesh' },
  UP76: { locationName: 'Farrukhabad', nameHi: 'फ़र्रूख़ाबाद', district: 'Farrukhabad', state: 'Uttar Pradesh' },
  UP77: { locationName: 'Kanpur Dehat', nameHi: 'कानपुर देहात', district: 'Kanpur Dehat', state: 'Uttar Pradesh' },
  UP78: { locationName: 'Kanpur', nameHi: 'कानपुर', district: 'Kanpur Nagar', state: 'Uttar Pradesh' },
  UP79: { locationName: 'Auraiya', nameHi: 'औरैया', district: 'Auraiya', state: 'Uttar Pradesh' },
  UP80: { locationName: 'Agra', nameHi: 'आगरा', district: 'Agra', state: 'Uttar Pradesh' },
  UP81: { locationName: 'Aligarh', nameHi: 'अलीगढ़', district: 'Aligarh', state: 'Uttar Pradesh' },
  UP82: { locationName: 'Etah', nameHi: 'एटा', district: 'Etah', state: 'Uttar Pradesh' },
  UP83: { locationName: 'Firozabad', nameHi: 'फ़िरोज़ाबाद', district: 'Firozabad', state: 'Uttar Pradesh' },
  UP84: { locationName: 'Mainpuri', nameHi: 'मैनपुरी', district: 'Mainpuri', state: 'Uttar Pradesh' },
  UP85: { locationName: 'Mathura', nameHi: 'मथुरा', district: 'Mathura', state: 'Uttar Pradesh' },
  UP86: { locationName: 'Hathras', nameHi: 'हाथरस', district: 'Hathras', state: 'Uttar Pradesh' },
  UP87: { locationName: 'Kasganj', nameHi: 'कासगंज', district: 'Kasganj', state: 'Uttar Pradesh' },
  UP90: { locationName: 'Banda', nameHi: 'बांदा', district: 'Banda', state: 'Uttar Pradesh' },
  UP91: { locationName: 'Hamirpur', nameHi: 'हमीरपुर', district: 'Hamirpur', state: 'Uttar Pradesh' },
  UP92: { locationName: 'Jalaun', nameHi: 'जालौन', district: 'Jalaun', state: 'Uttar Pradesh' },
  UP93: { locationName: 'Jhansi', nameHi: 'झाँसी', district: 'Jhansi', state: 'Uttar Pradesh' },
  UP94: { locationName: 'Lalitpur', nameHi: 'ललितपुर', district: 'Lalitpur', state: 'Uttar Pradesh' },
  UP95: { locationName: 'Mahoba', nameHi: 'महोबा', district: 'Mahoba', state: 'Uttar Pradesh' },
  UP96: { locationName: 'Chitrakoot', nameHi: 'चित्रकूट', district: 'Chitrakoot', state: 'Uttar Pradesh' },
  UP: { locationName: 'Uttar Pradesh', nameHi: 'उत्तर प्रदेश', district: 'Uttar Pradesh', state: 'Uttar Pradesh' },

  // =========================================================================
  // DELHI (DL)
  // =========================================================================
  DL01: { locationName: 'North Delhi', nameHi: 'उत्तरी दिल्ली', district: 'North Delhi', state: 'Delhi' },
  DL02: { locationName: 'New Delhi', nameHi: 'नई दिल्ली', district: 'New Delhi', state: 'Delhi' },
  DL03: { locationName: 'South Delhi', nameHi: 'दक्षिणी दिल्ली', district: 'South Delhi', state: 'Delhi' },
  DL04: { locationName: 'West Delhi', nameHi: 'पश्चिमी दिल्ली', district: 'West Delhi', state: 'Delhi' },
  DL05: { locationName: 'North-East Delhi', nameHi: 'उत्तर-पूर्वी दिल्ली', district: 'North East Delhi', state: 'Delhi' },
  DL06: { locationName: 'Central Delhi', nameHi: 'मध्य दिल्ली', district: 'Central Delhi', state: 'Delhi' },
  DL07: { locationName: 'Mayur Vihar', nameHi: 'मयूर विहार', district: 'East Delhi', state: 'Delhi' },
  DL08: { locationName: 'North-West Delhi', nameHi: 'उत्तर-पश्चिमी दिल्ली', district: 'North West Delhi', state: 'Delhi' },
  DL09: { locationName: 'Dwarka', nameHi: 'द्वारका', district: 'South West Delhi', state: 'Delhi' },
  DL10: { locationName: 'Rajouri Garden', nameHi: 'राजौरी गार्डन', district: 'West Delhi', state: 'Delhi' },
  DL11: { locationName: 'Rohini', nameHi: 'रोहिणी', district: 'North West Delhi', state: 'Delhi' },
  DL12: { locationName: 'Vasant Vihar', nameHi: 'वसंत विहार', district: 'South West Delhi', state: 'Delhi' },
  DL13: { locationName: 'Surajmal Vihar', nameHi: 'सूरजमल विहार', district: 'East Delhi', state: 'Delhi' },
  DL14: { locationName: 'Rohini', nameHi: 'रोहिणी', district: 'North West Delhi', state: 'Delhi' },
  DL40: { locationName: 'Delhi', nameHi: 'दिल्ली', district: 'Delhi', state: 'Delhi' },
  DL50: { locationName: 'Delhi', nameHi: 'दिल्ली', district: 'Delhi', state: 'Delhi' },
  DL52: { locationName: 'Delhi', nameHi: 'दिल्ली', district: 'Delhi', state: 'Delhi' },
  DL80: { locationName: 'Delhi', nameHi: 'दिल्ली', district: 'Delhi', state: 'Delhi' },
  DL: { locationName: 'Delhi', nameHi: 'दिल्ली', district: 'Delhi', state: 'Delhi' },

  // =========================================================================
  // HARYANA (HR)
  // =========================================================================
  HR01: { locationName: 'Ambala', nameHi: 'अंबाला', district: 'Ambala', state: 'Haryana' },
  HR02: { locationName: 'Jagadhri', nameHi: 'जगाधरी', district: 'Yamunanagar', state: 'Haryana' },
  HR03: { locationName: 'Panchkula', nameHi: 'पंचकूला', district: 'Panchkula', state: 'Haryana' },
  HR05: { locationName: 'Karnal', nameHi: 'करनाल', district: 'Karnal', state: 'Haryana' },
  HR06: { locationName: 'Panipat', nameHi: 'पानीपत', district: 'Panipat', state: 'Haryana' },
  HR07: { locationName: 'Kurukshetra', nameHi: 'कुरुक्षेत्र', district: 'Kurukshetra', state: 'Haryana' },
  HR08: { locationName: 'Kaithal', nameHi: 'कैथल', district: 'Kaithal', state: 'Haryana' },
  HR10: { locationName: 'Sonipat', nameHi: 'सोनीपत', district: 'Sonipat', state: 'Haryana' },
  HR11: { locationName: 'Gohana', nameHi: 'गोहाना', district: 'Sonipat', state: 'Haryana' },
  HR12: { locationName: 'Rohtak', nameHi: 'रोहतक', district: 'Rohtak', state: 'Haryana' },
  HR13: { locationName: 'Bahadurgarh', nameHi: 'बहादुरगढ़', district: 'Jhajjar', state: 'Haryana' },
  HR14: { locationName: 'Jhajjar', nameHi: 'झज्जर', district: 'Jhajjar', state: 'Haryana' },
  HR16: { locationName: 'Bhiwani', nameHi: 'भिवानी', district: 'Bhiwani', state: 'Haryana' },
  HR19: { locationName: 'Charkhi Dadri', nameHi: 'चरखी दादरी', district: 'Charkhi Dadri', state: 'Haryana' },
  HR20: { locationName: 'Hisar', nameHi: 'हिसार', district: 'Hisar', state: 'Haryana' },
  HR21: { locationName: 'Hansi', nameHi: 'हांसी', district: 'Hisar', state: 'Haryana' },
  HR22: { locationName: 'Fatehabad', nameHi: 'फतेहाबाद', district: 'Fatehabad', state: 'Haryana' },
  HR24: { locationName: 'Sirsa', nameHi: 'सिरसा', district: 'Sirsa', state: 'Haryana' },
  HR26: { locationName: 'Gurugram', nameHi: 'गुरुग्राम', district: 'Gurugram', state: 'Haryana' },
  HR27: { locationName: 'Nuh', nameHi: 'नूंह', district: 'Nuh', state: 'Haryana' },
  HR29: { locationName: 'Ballabgarh', nameHi: 'बल्लभगढ़', district: 'Faridabad', state: 'Haryana' },
  HR30: { locationName: 'Palwal', nameHi: 'पलवल', district: 'Palwal', state: 'Haryana' },
  HR31: { locationName: 'Jind', nameHi: 'जींद', district: 'Jind', state: 'Haryana' },
  HR34: { locationName: 'Mahendragarh', nameHi: 'महेंद्रगढ़', district: 'Mahendragarh', state: 'Haryana' },
  HR35: { locationName: 'Narnaul', nameHi: 'नारनौल', district: 'Mahendragarh', state: 'Haryana' },
  HR36: { locationName: 'Rewari', nameHi: 'रेवाड़ी', district: 'Rewari', state: 'Haryana' },
  HR51: { locationName: 'Faridabad', nameHi: 'फरीदाबाद', district: 'Faridabad', state: 'Haryana' },
  HR55: { locationName: 'Gurugram', nameHi: 'गुरुग्राम', district: 'Gurugram', state: 'Haryana' },
  HR58: { locationName: 'Jagadhri', nameHi: 'जगाधरी', district: 'Yamunanagar', state: 'Haryana' },
  HR76: { locationName: 'Pataudi', nameHi: 'पटौदी', district: 'Gurugram', state: 'Haryana' },
  HR98: { locationName: 'Badhra', nameHi: 'बाढड़ा', district: 'Charkhi Dadri', state: 'Haryana' },
  HR: { locationName: 'Haryana', nameHi: 'हरियाणा', district: 'Haryana', state: 'Haryana' },

  // =========================================================================
  // UTTARAKHAND (UK / UA)
  // =========================================================================
  UK01: { locationName: 'Almora', nameHi: 'अल्मोड़ा', district: 'Almora', state: 'Uttarakhand' },
  UK02: { locationName: 'Bageshwar', nameHi: 'बागेश्वर', district: 'Bageshwar', state: 'Uttarakhand' },
  UK03: { locationName: 'Champawat', nameHi: 'चंपावत', district: 'Champawat', state: 'Uttarakhand' },
  UK04: { locationName: 'Nainital', nameHi: 'नैनीताल', district: 'Nainital', state: 'Uttarakhand' },
  UK05: { locationName: 'Pithoragarh', nameHi: 'पिथौरागढ़', district: 'Pithoragarh', state: 'Uttarakhand' },
  UK06: { locationName: 'Rudrapur', nameHi: 'रुद्रपुर', district: 'Udham Singh Nagar', state: 'Uttarakhand' },
  UK07: { locationName: 'Dehradun', nameHi: 'देहरादून', district: 'Dehradun', state: 'Uttarakhand' },
  UK08: { locationName: 'Haridwar', nameHi: 'हरिद्वार', district: 'Haridwar', state: 'Uttarakhand' },
  UK09: { locationName: 'Tehri Garhwal', nameHi: 'टिहरी गढ़वाल', district: 'Tehri Garhwal', state: 'Uttarakhand' },
  UK10: { locationName: 'Uttarkashi', nameHi: 'उत्तरकाशी', district: 'Uttarkashi', state: 'Uttarakhand' },
  UK11: { locationName: 'Chamoli', nameHi: 'चमोली', district: 'Chamoli', state: 'Uttarakhand' },
  UK12: { locationName: 'Pauri Garhwal', nameHi: 'पौड़ी गढ़वाल', district: 'Pauri Garhwal', state: 'Uttarakhand' },
  UK13: { locationName: 'Rudraprayag', nameHi: 'रुद्रप्रयाग', district: 'Rudraprayag', state: 'Uttarakhand' },
  UK14: { locationName: 'Rishikesh', nameHi: 'ऋषिकेश', district: 'Dehradun', state: 'Uttarakhand' },
  UK15: { locationName: 'Kotdwar', nameHi: 'कोटद्वार', district: 'Pauri Garhwal', state: 'Uttarakhand' },
  UK17: { locationName: 'Roorkee', nameHi: 'रुड़की', district: 'Haridwar', state: 'Uttarakhand' },
  UK18: { locationName: 'Kashipur', nameHi: 'काशीपुर', district: 'Udham Singh Nagar', state: 'Uttarakhand' },
  UK19: { locationName: 'Ramnagar', nameHi: 'रामनगर', district: 'Nainital', state: 'Uttarakhand' },
  UK20: { locationName: 'Ranikhet', nameHi: 'रानीखेत', district: 'Almora', state: 'Uttarakhand' },
  UK: { locationName: 'Uttarakhand', nameHi: 'उत्तराखंड', district: 'Uttarakhand', state: 'Uttarakhand' },

  // =========================================================================
  // RAJASTHAN (RJ)
  // =========================================================================
  RJ01: { locationName: 'Ajmer', nameHi: 'अजमेर', district: 'Ajmer', state: 'Rajasthan' },
  RJ02: { locationName: 'Alwar', nameHi: 'अलवर', district: 'Alwar', state: 'Rajasthan' },
  RJ03: { locationName: 'Banswara', nameHi: 'बांसवाड़ा', district: 'Banswara', state: 'Rajasthan' },
  RJ04: { locationName: 'Barmer', nameHi: 'बाड़मेर', district: 'Barmer', state: 'Rajasthan' },
  RJ05: { locationName: 'Bharatpur', nameHi: 'भरतपुर', district: 'Bharatpur', state: 'Rajasthan' },
  RJ06: { locationName: 'Bhilwara', nameHi: 'भीलवाड़ा', district: 'Bhilwara', state: 'Rajasthan' },
  RJ07: { locationName: 'Bikaner', nameHi: 'बीकानेर', district: 'Bikaner', state: 'Rajasthan' },
  RJ08: { locationName: 'Bundi', nameHi: 'बूंदी', district: 'Bundi', state: 'Rajasthan' },
  RJ09: { locationName: 'Chittorgarh', nameHi: 'चित्तौड़गढ़', district: 'Chittorgarh', state: 'Rajasthan' },
  RJ10: { locationName: 'Churu', nameHi: 'चूरू', district: 'Churu', state: 'Rajasthan' },
  RJ11: { locationName: 'Dholpur', nameHi: 'धौलपुर', district: 'Dholpur', state: 'Rajasthan' },
  RJ12: { locationName: 'Dungarpur', nameHi: 'डूंगरपुर', district: 'Dungarpur', state: 'Rajasthan' },
  RJ13: { locationName: 'Sri Ganganagar', nameHi: 'श्रीगंगानगर', district: 'Ganganagar', state: 'Rajasthan' },
  RJ14: { locationName: 'Jaipur Central', nameHi: 'जयपुर सेंट्रल', district: 'Jaipur', state: 'Rajasthan' },
  RJ15: { locationName: 'Jaisalmer', nameHi: 'जैसलमेर', district: 'Jaisalmer', state: 'Rajasthan' },
  RJ16: { locationName: 'Jalore', nameHi: 'जालौर', district: 'Jalore', state: 'Rajasthan' },
  RJ17: { locationName: 'Jhalawar', nameHi: 'झालावाड़', district: 'Jhalawar', state: 'Rajasthan' },
  RJ18: { locationName: 'Jhunjhunu', nameHi: 'झुंझुनू', district: 'Jhunjhunu', state: 'Rajasthan' },
  RJ19: { locationName: 'Jodhpur', nameHi: 'जोधपुर', district: 'Jodhpur', state: 'Rajasthan' },
  RJ20: { locationName: 'Kota', nameHi: 'कोटा', district: 'Kota', state: 'Rajasthan' },
  RJ21: { locationName: 'Nagaur', nameHi: 'नागौर', district: 'Nagaur', state: 'Rajasthan' },
  RJ22: { locationName: 'Pali', nameHi: 'पाली', district: 'Pali', state: 'Rajasthan' },
  RJ23: { locationName: 'Sikar', nameHi: 'सीकर', district: 'Sikar', state: 'Rajasthan' },
  RJ24: { locationName: 'Sirohi', nameHi: 'सिरोही', district: 'Sirohi', state: 'Rajasthan' },
  RJ25: { locationName: 'Sawai Madhopur', nameHi: 'सवाई माधोपुर', district: 'Sawai Madhopur', state: 'Rajasthan' },
  RJ26: { locationName: 'Tonk', nameHi: 'टोंक', district: 'Tonk', state: 'Rajasthan' },
  RJ27: { locationName: 'Udaipur', nameHi: 'उदयपुर', district: 'Udaipur', state: 'Rajasthan' },
  RJ28: { locationName: 'Baran', nameHi: 'बारां', district: 'Baran', state: 'Rajasthan' },
  RJ29: { locationName: 'Dausa', nameHi: 'दौसा', district: 'Dausa', state: 'Rajasthan' },
  RJ30: { locationName: 'Rajsamand', nameHi: 'राजसमंद', district: 'Rajsamand', state: 'Rajasthan' },
  RJ31: { locationName: 'Hanumangarh', nameHi: 'हनुमानगढ़', district: 'Hanumangarh', state: 'Rajasthan' },
  RJ40: { locationName: 'Bhiwadi', nameHi: 'भिवाड़ी', district: 'Alwar', state: 'Rajasthan' },
  RJ45: { locationName: 'Jaipur South', nameHi: 'जयपुर साउथ', district: 'Jaipur', state: 'Rajasthan' },
  RJ: { locationName: 'Rajasthan', nameHi: 'राजस्थान', district: 'Rajasthan', state: 'Rajasthan' },

  // =========================================================================
  // MADHYA PRADESH (MP)
  // =========================================================================
  MP04: { locationName: 'Bhopal', nameHi: 'भोपाल', district: 'Bhopal', state: 'Madhya Pradesh' },
  MP07: { locationName: 'Gwalior', nameHi: 'ग्वालियर', district: 'Gwalior', state: 'Madhya Pradesh' },
  MP08: { locationName: 'Guna', nameHi: 'गुना', district: 'Guna', state: 'Madhya Pradesh' },
  MP09: { locationName: 'Indore', nameHi: 'इंदौर', district: 'Indore', state: 'Madhya Pradesh' },
  MP13: { locationName: 'Ujjain', nameHi: 'उज्जैन', district: 'Ujjain', state: 'Madhya Pradesh' },
  MP15: { locationName: 'Sagar', nameHi: 'सागर', district: 'Sagar', state: 'Madhya Pradesh' },
  MP16: { locationName: 'Chhatarpur', nameHi: 'छतरपुर', district: 'Chhatarpur', state: 'Madhya Pradesh' },
  MP17: { locationName: 'Rewa', nameHi: 'रीवा', district: 'Rewa', state: 'Madhya Pradesh' },
  MP18: { locationName: 'Shahdol', nameHi: 'शहडोल', district: 'Shahdol', state: 'Madhya Pradesh' },
  MP19: { locationName: 'Satna', nameHi: 'सतना', district: 'Satna', state: 'Madhya Pradesh' },
  MP20: { locationName: 'Jabalpur', nameHi: 'जबलपुर', district: 'Jabalpur', state: 'Madhya Pradesh' },
  MP44: { locationName: 'Neemuch', nameHi: 'नीमच', district: 'Neemuch', state: 'Madhya Pradesh' },
  MP: { locationName: 'Madhya Pradesh', nameHi: 'मध्य प्रदेश', district: 'Madhya Pradesh', state: 'Madhya Pradesh' },

  // =========================================================================
  // JHARKHAND (JH)
  // =========================================================================
  JH01: { locationName: 'Ranchi', nameHi: 'राँची', district: 'Ranchi', state: 'Jharkhand' },
  JH02: { locationName: 'Hazaribagh', nameHi: 'हज़ारीबाग़', district: 'Hazaribagh', state: 'Jharkhand' },
  JH05: { locationName: 'Jamshedpur', nameHi: 'जमशेदपुर', district: 'East Singhbhum', state: 'Jharkhand' },
  JH09: { locationName: 'Bokaro', nameHi: 'बोकारो', district: 'Bokaro', state: 'Jharkhand' },
  JH10: { locationName: 'Dhanbad', nameHi: 'धनबाद', district: 'Dhanbad', state: 'Jharkhand' },
  JH: { locationName: 'Jharkhand', nameHi: 'झारखंड', district: 'Jharkhand', state: 'Jharkhand' },

  // =========================================================================
  // BIHAR (BR)
  // =========================================================================
  BR01: { locationName: 'Patna', nameHi: 'पटना', district: 'Patna', state: 'Bihar' },
  BR02: { locationName: 'Gaya', nameHi: 'गया', district: 'Gaya', state: 'Bihar' },
  BR06: { locationName: 'Muzaffarpur', nameHi: 'मुज़फ़्फ़रपुर', district: 'Muzaffarpur', state: 'Bihar' },
  BR10: { locationName: 'Bhagalpur', nameHi: 'भागलपुर', district: 'Bhagalpur', state: 'Bihar' },
  BR: { locationName: 'Bihar', nameHi: 'बिहार', district: 'Bihar', state: 'Bihar' },

  // =========================================================================
  // PUNJAB (PB) & CHANDIGARH (CH)
  // =========================================================================
  PB01: { locationName: 'Chandigarh', nameHi: 'चंडीगढ़', district: 'Chandigarh', state: 'Punjab' },
  PB02: { locationName: 'Amritsar', nameHi: 'अमृतसर', district: 'Amritsar', state: 'Punjab' },
  PB03: { locationName: 'Bathinda', nameHi: 'बठिंडा', district: 'Bathinda', state: 'Punjab' },
  PB08: { locationName: 'Jalandhar', nameHi: 'जालंधर', district: 'Jalandhar', state: 'Punjab' },
  PB10: { locationName: 'Ludhiana', nameHi: 'लुधियाना', district: 'Ludhiana', state: 'Punjab' },
  PB11: { locationName: 'Patiala', nameHi: 'पटियाला', district: 'Patiala', state: 'Punjab' },
  PB65: { locationName: 'Mohali', nameHi: 'मोहाली', district: 'SAS Nagar', state: 'Punjab' },
  PB: { locationName: 'Punjab', nameHi: 'पंजाब', district: 'Punjab', state: 'Punjab' },
  CH01: { locationName: 'Chandigarh', nameHi: 'चंडीगढ़', district: 'Chandigarh', state: 'Chandigarh' },
  CH: { locationName: 'Chandigarh', nameHi: 'चंडीगढ़', district: 'Chandigarh', state: 'Chandigarh' },

  // =========================================================================
  // HIMACHAL PRADESH (HP)
  // =========================================================================
  HP01: { locationName: 'Shimla', nameHi: 'शिमला', district: 'Shimla', state: 'Himachal Pradesh' },
  HP14: { locationName: 'Solan', nameHi: 'सोलन', district: 'Solan', state: 'Himachal Pradesh' },
  HP34: { locationName: 'Kullu', nameHi: 'कुल्लू', district: 'Kullu', state: 'Himachal Pradesh' },
  HP68: { locationName: 'Dharamshala', nameHi: 'धर्मशाला', district: 'Kangra', state: 'Himachal Pradesh' },
  HP: { locationName: 'Himachal Pradesh', nameHi: 'हिमाचल प्रदेश', district: 'Himachal Pradesh', state: 'Himachal Pradesh' },

  // =========================================================================
  // BHARAT SERIES (BH)
  // =========================================================================
  BH24: { locationName: 'Bharat Series (2024)', nameHi: 'भारत सीरीज', district: 'National', state: 'All India' },
  BH: { locationName: 'Bharat Series', nameHi: 'भारत सीरीज', district: 'National', state: 'All India' },
};

/**
 * Looks up an RTO registration prefix in the directory.
 *
 * Returns full location information if found, or maps the 2-letter state prefix
 * to the corresponding State name if the specific RTO is unknown.
 */
export function lookupRtoPrefix(prefix: string): {
  prefix: string;
  locationName: string;
  district: string;
  state: string;
  nameHi?: string;
  isExactRto: boolean;
} | null {
  const clean = prefix.trim().toUpperCase();
  if (!clean) return null;

  // 1. Direct RTO match
  if (RTO_DIRECTORY[clean]) {
    const entry = RTO_DIRECTORY[clean];
    return {
      prefix: clean,
      locationName: entry.locationName,
      district: entry.district || entry.locationName,
      state: entry.state,
      nameHi: entry.nameHi,
      isExactRto: true,
    };
  }

  // 2. Check 2-letter state code prefix (e.g. "UP" from "UP03" or "UP99")
  const stateCode = clean.slice(0, 2);
  if (STATE_PREFIX_MAP[stateCode]) {
    return {
      prefix: clean,
      locationName: '',
      district: '',
      state: STATE_PREFIX_MAP[stateCode],
      isExactRto: false,
    };
  }

  return null;
}
