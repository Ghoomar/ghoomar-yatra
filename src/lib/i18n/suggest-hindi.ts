/**
 * Reusable Bilingual Master-Data Hindi Suggestion Engine
 * 
 * Provides deterministic, high-quality, operational Hindi / familiar Devanagari suggestions
 * for controlled master data (menu items, categories, inventory, units, roles, locations)
 * while preserving proper names (vendors, customers, staff persons) and identifiers verbatim.
 */

export type MasterEntityType =
  | 'general'
  | 'menu_item'
  | 'category'
  | 'inventory_item'
  | 'vendor'
  | 'person'
  | 'role'
  | 'unit'
  | 'location'
  | 'cost_rule'
  | 'department'
  | 'expense_category';

export interface HindiSuggestionResult {
  suggestion: string;
  isTransliterated: boolean;
  confidence: 'high' | 'medium' | 'verbatim';
}

// 1. Authoritative Compound Phrases (Exact Case-Insensitive Match)
const EXACT_PHRASE_DICTIONARY: Record<string, string> = {
  // Menu Master Categories
  'all day breakfast': 'ऑल डे नाश्ता',
  'main course': 'मुख्य भोजन',
  'chinese': 'चाइनीज़',
  'beverages': 'बेवरेज',
  'indian': 'भारतीय भोजन',
  'indian meals': 'भारतीय भोजन',
  'italian': 'इटालियन',
  'rajasthani': 'राजस्थानी',
  'soya specials': 'सोया स्पेशल',
  'soya chaap special': 'सोया स्पेशल',
  'chinese starters': 'चाइनीज़ स्टार्टर्स',
  'chinese main course': 'चाइनीज़ मेन कोर्स',
  'chinese noodles & rice': 'चाइनीज़ नूडल्स और राइस',
  'classic beverages': 'क्लासिक बेवरेज',
  'classic sandwiches': 'क्लासिक सैंडविच',
  'parantha favourites': 'पसंदीदा परांठे',
  'paneer preprations': 'पनीर स्पेशल',
  'subziyon ki bahaar': 'सब्ज़ियों की बहार',
  'rajasthani specialities': 'राजस्थानी खासियतें',
  'rajasthani specilities': 'राजस्थानी खासियतें',
  'soya specials starters': 'सोया स्पेशल स्टार्टर्स',
  'soya specials main course': 'सोया स्पेशल मेन कोर्स',
  'fine dine': 'डाइनिंग',
  'snacks & stalls': 'स्नैक्स और स्टॉल',
  'paid activities': 'पेड गतिविधियां',

  // Inventory Categories
  'cooking oils & ghee': 'कुकिंग ऑयल और घी',
  'dairy & paneer': 'डेयरी और पनीर',
  'fresh vegetables': 'ताज़ी सब्ज़ियाँ',
  'grains & grocery': 'अनाज और किराना',
  'cutlery & crockery': 'कटलरी और क्रॉकरी',
  'fuel & generator': 'ईंधन और जनरेटर',
  'fuel & lpg': 'ईंधन और एलपीजी',
  'staff uniforms': 'स्टाफ यूनिफॉर्म',
  'stationary': 'स्टेशनरी',
  'cleaning & sanitation': 'सफाई और स्वच्छता',
  'maintenance & hardware': 'मेंटेनेंस और हार्डवेयर',
  'guest entertainment': 'गेस्ट मनोरंजन',
  'staff welfare': 'स्टाफ कल्याण',
  'marketing & highway signs': 'मार्केटिंग और हाईवे बोर्ड',
  'repairs & maintenance': 'मरम्मत और रखरखाव',
  'miscellaneous': 'विविध खर्च',

  // Store & Organization Locations
  'central store room': 'सेंट्रल स्टोर रूम',
  'central store': 'सेंट्रल स्टोर',
  'beverage counter': 'बेवरेज काउंटर',
  'kitchen production area': 'किचन प्रोडक्शन एरिया',
  'maharaja dining hall': 'महाराजा डाइनिंग हॉल',
  'maharani dining hall': 'महारानी डाइनिंग हॉल',
  'maharaja hall': 'महाराजा हॉल',
  'maharani hall': 'महारानी हॉल',
  'entertainment area': 'मनोरंजन क्षेत्र',
  'gate & security': 'गेट और सिक्योरिटी',
  'north indian kitchen': 'नॉर्थ इंडियन किचन',
  'chinese kitchen': 'चाइनीज़ किचन',
  'tandoori section': 'तंदूरी सेक्शन',
  'beverage & juice section': 'बेवरेज और जूस सेक्शन',
  'snacks & chaat section': 'स्नैक्स और चाट सेक्शन',
  'management': 'मैनेजमेंट',
  'accounts & admin': 'लेखा एवं प्रशासन',
  'kitchen & production': 'रसोई एवं उत्पादन',
  'service & beverage': 'सर्विस एवं पेय पदार्थ',
  'stores & inventory': 'स्टोर एवं इन्वेंटरी',
  'performances & activities': 'कला व सांस्कृतिक गतिविधियां',

  // Roles
  'head chef': 'हेड शेफ',
  'chef': 'शेफ',
  'cook': 'कुक',
  'captain': 'कैप्टन',
  'steward': 'स्टीवर्ड',
  'cashier': 'कैशियर',
  'storekeeper': 'स्टोरकीपर',
  'manager': 'मैनेजर',
  'gate marshall': 'गेट मार्शल',
  'commis chef': 'सहायक रसोइया',
  'accountant': 'अकाउंटेंट',

  // Payment Methods
  'cash': 'नकद',
  'card': 'कार्ड',
  'bank transfer': 'बैंक ट्रांसफर',
  'upi': 'यूपीआई',
  'lancho': 'लांचो',
  'other': 'अन्य',

  // Units
  'kilogram': 'किलोग्राम',
  'gram': 'ग्राम',
  'liter': 'लीटर',
  'milliliter': 'मिलीलीटर',
  'piece': 'पीस',
  'box': 'बॉक्स',
  'cylinder': 'सिलेंडर',

  // Activities
  'camel ride': 'ऊँट की सवारी',
  'champi maalish': 'चंपी मालिश',
  'game stalls': 'खेल स्टॉल',
  'mehendi': 'मेहंदी',

  // Financial Cost Rules
  'property rent': 'संपत्ति किराया',
  'internet & telecom': 'इंटरनेट और टेलीकॉम',
  'electricity (operational estimate)': 'बिजली (अनुमानित लागत)',
  'investor share': 'निवेशक हिस्सा',

  // Common Inventory Items
  'sunflower oil': 'सनफ्लावर ऑयल',
  'refined sunflower oil': 'रिफाइंड सनफ्लावर ऑयल',
  'refined mustard oil': 'रिफाइंड सरसों का तेल',
  'mustard oil': 'सरसों का तेल',
  'desi ghee': 'देसी घी',
  'fresh malai paneer': 'ताज़ा मलाई पनीर',
  'malai paneer': 'मलाई पनीर',
  'paneer': 'पनीर',
  'stainless steel table spoons': 'स्टेनलेस स्टील चम्मच',
  'napkin stand': 'नैपकिन स्टैंड',
  'wall-mounted liquid soap dispenser': 'लिक्विड सोप डिस्पेंसर',
  'service khaki shirt (m)': 'सर्विस खाकी शर्ट (M)',
  'service khaki shirt': 'सर्विस खाकी शर्ट',

  // Common Menu Items
  'premium thali': 'प्रीमियम थाली',
  'punjabi premium thali': 'पंजाबी प्रीमियम थाली',
  'punjabi special thali': 'पंजाबी स्पेशल थाली',
  'executive thali': 'एग्जीक्यूटिव थाली',
  'special thali': 'स्पेशल थाली',
  'aloo onion paratha': 'आलू प्याज़ पराठा',
  'aloo pyaaz paratha': 'आलू प्याज़ पराठा',
  'yatra special thali': 'यात्रा स्पेशल थाली',
};

// 2. Comprehensive Vocabulary Word Dictionary (English Word -> Devanagari)
const WORD_DICTIONARY: Record<string, string> = {
  // Connectors & Common Qualifiers
  '&': 'और',
  'and': 'और',
  'or': 'या',
  'of': 'का',
  'with': 'सहित',
  'special': 'स्पेशल',
  'specials': 'स्पेशल',
  'executive': 'एग्जीक्यूटिव',
  'premium': 'प्रीमियम',
  'deluxe': 'डीलक्स',
  'royal': 'रॉयल',
  'classic': 'क्लासिक',
  'regular': 'रेगुलर',
  'small': 'छोटा',
  'large': 'बड़ा',
  'medium': 'मीडियम',
  'extra': 'एक्स्ट्रा',
  'fresh': 'ताज़ा',
  'fried': 'फ्राइड',
  'crispy': 'क्रिस्पी',
  'hot': 'हॉट',
  'cold': 'कोल्ड',
  'sweet': 'मीठा',
  'spicy': 'मसालेदार',
  'steamed': 'स्टीम्ड',
  'roasted': 'रोस्टेड',
  'boiled': 'उबला',
  'stuffed': 'भरवां',
  'pure': 'शुद्ध',
  'refined': 'रिफाइंड',
  'dry': 'ड्राई',
  'gravy': 'ग्रेवी',

  // Basic Foods & Preparations
  'thali': 'थाली',
  'paratha': 'पराठा',
  'parantha': 'परांठा',
  'roti': 'रोटी',
  'naan': 'नान',
  'kulcha': 'कुलचा',
  'puri': 'पूरी',
  'bhatura': 'भटूरा',
  'bhature': 'भटूरे',
  'chole': 'छोले',
  'dal': 'दाल',
  'makhani': 'मखनी',
  'tadka': 'तड़का',
  'fry': 'फ्राई',
  'rice': 'चावल',
  'jeera': 'जीरा',
  'pulao': 'पुलाव',
  'biryani': 'बिरयानी',
  'khichdi': 'खिचड़ी',
  'sabzi': 'सब्ज़ी',
  'subzi': 'सब्ज़ी',
  'curry': 'करी',
  'kofta': 'कोफ्ता',
  'kadhai': 'कड़ाही',
  'handi': 'हांडी',
  'tawa': 'तवा',
  'shahi': 'शाही',
  'butter': 'बटर',
  'masala': 'मसाला',
  'paneer': 'पनीर',
  'soya': 'सोया',
  'chaap': 'चाप',
  'mushroom': 'मशरूम',
  'corn': 'कॉर्न',
  'raita': 'रायता',
  'boondi': 'बूंदी',
  'papad': 'पापड़',
  'salad': 'सलाद',
  'soup': 'सूप',
  'snacks': 'स्नैक्स',
  'starter': 'स्टार्टर',
  'starters': 'स्टार्टर्स',
  'platter': 'प्लैट्टर',
  'combo': 'कॉम्बो',
  'roll': 'रोल',
  'sandwich': 'सैंडविच',
  'sandwiches': 'सैंडविच',
  'pizza': 'पिज़्ज़ा',
  'pasta': 'पास्ता',
  'burger': 'बर्गर',
  'garlic': 'गार्लिक',
  'bread': 'ब्रेड',
  'noodles': 'नूडल्स',
  'manchurian': 'मंचूरियन',
  'maggi': 'मैगी',
  'chaat': 'चाट',
  'tikki': 'टिक्की',
  'samosa': 'समोसा',
  'kachori': 'कचौरी',
  'dahi': 'दही',
  'bhalla': 'भल्ला',
  'golgappa': 'गोलगप्पा',
  'pav': 'पाव',
  'bhaji': 'भाजी',

  // Regional / Cultural
  'punjabi': 'पंजाबी',
  'rajasthani': 'राजस्थानी',
  'marwadi': 'मारवाड़ी',
  'gujarati': 'गुजराती',
  'south': 'साउथ',
  'north': 'नॉर्थ',
  'chinese': 'चाइनीज़',
  'italian': 'इटालियन',
  'continental': 'कॉन्टिनेंटल',
  'yatra': 'यात्रा',
  'ghoomar': 'घूमर',
  'jodhpuri': 'जोधपुरी',
  'bikaneri': 'बीकानेरी',
  'jaipuri': 'जयपुरी',
  'gatta': 'गट्टा',
  'gatte': 'गट्टे',
  'sangri': 'सांगरी',
  'kair': 'कैर',
  'churma': 'चूरमा',
  'baati': 'बाटी',
  'khoba': 'खोबा',

  // Vegetables & Ingredients
  'oil': 'ऑयल',
  'oils': 'ऑयल',
  'sunflower': 'सनफ्लावर',
  'mustard': 'सरसों',
  'ghee': 'घी',
  'wheat': 'गेहूं',
  'flour': 'आटा',
  'atta': 'आटा',
  'maida': 'मैदा',
  'besan': 'बेसन',
  'suji': 'सूजी',
  'sugar': 'चीनी',
  'salt': 'नमक',
  'milk': 'दूध',
  'cream': 'मलाई',
  'cheese': 'चीज़',
  'curd': 'दही',
  'potato': 'आलू',
  'aloo': 'आलू',
  'tomato': 'टमाटर',
  'tamatar': 'टमाटर',
  'onion': 'प्याज़',
  'pyaaz': 'प्याज़',
  'ginger': 'अदरक',
  'adrak': 'अदरक',
  'lahsun': 'लहसुन',
  'chilli': 'मिर्च',
  'mirch': 'मिर्च',
  'coriander': 'धनिया',
  'dhaniya': 'धनिया',
  'mint': 'पुदीना',
  'lemon': 'नींबू',
  'nimbu': 'नींबू',
  'peas': 'मटर',
  'matar': 'मटर',
  'gobhi': 'गोभी',
  'cauliflower': 'गोभी',
  'cabbage': 'पत्ता गोभी',
  'capsicum': 'शिमला मिर्च',
  'carrot': 'गाजर',
  'cucumber': 'खीरा',
  'kheera': 'खीरा',
  'methi': 'मेथी',
  'palak': 'पालक',
  'spinach': 'पालक',
  'kaju': 'काजू',
  'cashew': 'काजू',
  'badam': 'बादाम',
  'almond': 'बादाम',
  'pista': 'पिस्ता',
  'raisins': 'किशमिश',
  'kishmish': 'किशमिश',
  'sev': 'सेव',
  'namkeen': 'नमकीन',
  'chana': 'चना',
  'rajma': 'राजमा',
  'moong': 'मूंग',
  'urad': 'उड़द',
  'toor': 'तूर',
  'masoor': 'मसूर',

  // Beverages & Sweets
  'tea': 'चाय',
  'chai': 'चाय',
  'coffee': 'कॉफ़ी',
  'shake': 'शेक',
  'milkshake': 'मिल्कशेक',
  'milkshakes': 'मिल्कशेक',
  'mocktail': 'मॉकटेल',
  'mocktails': 'मॉकटेल',
  'juice': 'जूस',
  'lassi': 'लस्सी',
  'chhach': 'छाछ',
  'buttermilk': 'छाछ',
  'water': 'पानी',
  'soda': 'सोडा',
  'cooler': 'कूलर',
  'mojito': 'मोहितो',
  'dessert': 'डेज़र्ट',
  'desserts': 'डेज़र्ट',
  'sweets': 'मिठाई',
  'gulab': 'गुलाब',
  'jamun': 'जामुन',
  'rasgulla': 'रसगुल्ला',
  'halwa': 'हलवा',
  'kheer': 'खीर',
  'ice': 'आइस',
  'icecream': 'आइसक्रीम',
  'ice cream': 'आइसक्रीम',
  'kulfi': 'कुल्फी',
  'rabdi': 'रबड़ी',
  'jalebi': 'जलेबी',

  // Store, Supplies & Hardware
  'gas': 'गैस',
  'lpg': 'एलपीजी',
  'commercial': 'कमर्शियल',
  'cylinder': 'सिलेंडर',
  'diesel': 'डीजल',
  'fuel': 'ईंधन',
  'detergent': 'डिटर्जेंट',
  'soap': 'साबुन',
  'liquid': 'लिक्विड',
  'dispenser': 'डिस्पेंसर',
  'sanitizer': 'सैनिटाइज़र',
  'broom': 'झाड़ू',
  'wiper': 'वाइपर',
  'pocha': 'पोछा',
  'tissue': 'टिशू',
  'napkin': 'नैपकिन',
  'paper': 'पेपर',
  'box': 'बॉक्स',
  'boxes': 'बॉक्स',
  'packaging': 'पैकेजिंग',
  'disposables': 'डिस्पोजेबल',
  'foil': 'फॉइल',
  'glass': 'ग्लास',
  'cup': 'कप',
  'cups': 'कप',
  'plate': 'प्लेट',
  'plates': 'प्लेट',
  'spoon': 'चम्मच',
  'spoons': 'चम्मच',
  'fork': 'कांटा',
  'forks': 'कांटे',
  'bowl': 'कटोरी',
  'bowls': 'कटोरी',
  'knife': 'चाकू',
  'dustbin': 'कूड़ेदान',
  'bag': 'बैग',
  'bags': 'बैग',
  'garbage': 'कचरा',
  'uniform': 'यूनिफॉर्म',
  'uniforms': 'यूनिफॉर्म',
  'shirt': 'शर्ट',
  'pant': 'पैंट',
  'trousers': 'पैंट',
  'apron': 'एप्रन',
  'cap': 'कैप',
  'gloves': 'दस्ताने',
  'tie': 'टाई',
  'khaki': 'खाकी',
  'table': 'टेबल',
  'stand': 'स्टैंड',
  'stainless': 'स्टेनलेस',
  'steel': 'स्टील',

  // Organization & Staffing
  'kitchen': 'किचन',
  'service': 'सर्विस',
  'stores': 'स्टोर्स',
  'store': 'स्टोर',
  'room': 'रूम',
  'counter': 'काउंटर',
  'area': 'एरिया',
  'hall': 'हॉल',
  'section': 'सेक्शन',
  'gate': 'गेट',
  'security': 'सिक्योरिटी',
  'production': 'प्रोडक्शन',
  'accounts': 'लेखा',
  'admin': 'प्रशासन',
  'head': 'हेड',
  'marshall': 'मार्शल',
  'captain': 'कैप्टन',
  'steward': 'स्टीवर्ड',
  'cashier': 'कैशियर',
  'storekeeper': 'स्टोरकीपर',
  'manager': 'मैनेजर',
  'assistant': 'सहायक',
  'welfare': 'कल्याण',
  'entertainment': 'मनोरंजन',
  'activities': 'गतिविधियां',
  'attractions': 'आकर्षण',

  // Units
  'kg': 'किग्रा',
  'gm': 'ग्रा',
  'g': 'ग्रा',
  'ltr': 'ली',
  'l': 'ली',
  'ml': 'मिली',
  'pcs': 'पीस',
  'pc': 'पीस',
  'pkt': 'पैकेट',
  'packet': 'पैकेट',
  'bottle': 'बोतल',
};

// 3. Fallback Phonetic Transliteration (English Alphabet to Devanagari)
// Used gracefully when an unfamiliar culinary or operational term is encountered
const PHONETIC_CONSONANTS: [RegExp, string][] = [
  [/^kh/i, 'ख'],
  [/^gh/i, 'घ'],
  [/^ch/i, 'च'],
  [/^chh/i, 'छ'],
  [/^jh/i, 'झ'],
  [/^th/i, 'थ'],
  [/^dh/i, 'ध'],
  [/^ph/i, 'फ'],
  [/^bh/i, 'भ'],
  [/^sh/i, 'श'],
  [/^shh/i, 'ष'],
  [/^k/i, 'क'],
  [/^g/i, 'ग'],
  [/^c/i, 'क'],
  [/^j/i, 'ज'],
  [/^t/i, 'ट'],
  [/^d/i, 'ड'],
  [/^n/i, 'न'],
  [/^p/i, 'प'],
  [/^f/i, 'फ'],
  [/^b/i, 'ब'],
  [/^m/i, 'म'],
  [/^y/i, 'य'],
  [/^r/i, 'र'],
  [/^l/i, 'ल'],
  [/^v/i, 'व'],
  [/^w/i, 'व'],
  [/^s/i, 'स'],
  [/^h/i, 'ह'],
  [/^z/i, 'ज़'],
  [/^q/i, 'क'],
  [/^x/i, 'क्स'],
];

const PHONETIC_VOWELS: [RegExp, string][] = [
  [/^aa/i, 'ा'],
  [/^ee/i, 'ी'],
  [/^oo/i, 'ू'],
  [/^ai/i, 'ै'],
  [/^au/i, 'ौ'],
  [/^ou/i, 'ौ'],
  [/^a/i, 'ा'],
  [/^e/i, 'े'],
  [/^i/i, 'ि'],
  [/^o/i, 'ो'],
  [/^u/i, 'ु'],
];

const INITIAL_VOWELS: [RegExp, string][] = [
  [/^aa/i, 'आ'],
  [/^ee/i, 'ई'],
  [/^oo/i, 'ऊ'],
  [/^ai/i, 'ऐ'],
  [/^au/i, 'औ'],
  [/^ou/i, 'औ'],
  [/^a/i, 'अ'],
  [/^e/i, 'ए'],
  [/^i/i, 'इ'],
  [/^o/i, 'ओ'],
  [/^u/i, 'उ'],
];

/**
 * Phonetically transliterates a single English word into natural Devanagari.
 */
function transliterateWord(word: string): string {
  if (!word) return '';
  let str = word.toLowerCase();
  let result = '';
  let isStart = true;

  while (str.length > 0) {
    if (isStart) {
      // Check initial vowel
      let matchedVowel = false;
      for (const [re, dev] of INITIAL_VOWELS) {
        const m = str.match(re);
        if (m) {
          result += dev;
          str = str.slice(m[0].length);
          isStart = false;
          matchedVowel = true;
          break;
        }
      }
      if (matchedVowel) continue;
    }

    // Check consonant
    let matchedConsonant = false;
    for (const [re, dev] of PHONETIC_CONSONANTS) {
      const m = str.match(re);
      if (m) {
        result += dev;
        str = str.slice(m[0].length);
        isStart = false;
        matchedConsonant = true;

        // Check following vowel matra
        for (const [vre, vdev] of PHONETIC_VOWELS) {
          const vm = str.match(vre);
          if (vm) {
            result += vdev;
            str = str.slice(vm[0].length);
            break;
          }
        }
        break;
      }
    }
    if (matchedConsonant) continue;

    // Fallback single character advance
    str = str.slice(1);
  }

  return result || word;
}

/**
 * Suggests an authoritative Hindi display name for a given English master-data name.
 * 
 * Rules:
 * - Proper names (vendor, person) are strictly preserved verbatim.
 * - Exact compound matches are prioritized.
 * - Token-based dictionary lookup is executed for multi-word phrases.
 * - Fallback phonetic transliteration is used for unknown words.
 * - Trailing POS tags like [D], [T] are cleaned up gracefully.
 */
export function suggestHindiName(
  englishName: string,
  entityType: MasterEntityType = 'general'
): HindiSuggestionResult {
  if (!englishName || !englishName.trim()) {
    return { suggestion: '', isTransliterated: false, confidence: 'high' };
  }

  const cleanRaw = englishName.trim();

  // 1. Strict Proper Name preservation (Vendors & People)
  if (entityType === 'vendor' || entityType === 'person') {
    return {
      suggestion: cleanRaw,
      isTransliterated: false,
      confidence: 'verbatim',
    };
  }

  // 2. Strip trailing POS service tags for name suggestion: e.g. "Dal Makhani [D]" -> "Dal Makhani"
  const cleanDisplay = cleanRaw
    .replace(/\s*\[(?:d|t|delivery)\]\s*$/i, '')
    .trim();

  const lowerDisplay = cleanDisplay.toLowerCase();

  // 3. Exact Compound Phrase Match
  if (EXACT_PHRASE_DICTIONARY[lowerDisplay]) {
    return {
      suggestion: EXACT_PHRASE_DICTIONARY[lowerDisplay],
      isTransliterated: false,
      confidence: 'high',
    };
  }

  // Also check without trailing tags or brackets
  const baseWithoutBrackets = lowerDisplay.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (EXACT_PHRASE_DICTIONARY[baseWithoutBrackets]) {
    return {
      suggestion: EXACT_PHRASE_DICTIONARY[baseWithoutBrackets],
      isTransliterated: false,
      confidence: 'high',
    };
  }

  // 4. Token-by-token Translation & Transliteration
  // Split preserving delimiters like &, /, -
  const tokens = cleanDisplay.split(/(\s+|&|\/|-)/);
  const translatedTokens: string[] = [];
  let usedTransliteration = false;

  for (const token of tokens) {
    if (!token || /^\s+$/.test(token)) {
      translatedTokens.push(token);
      continue;
    }

    const trimmedLower = token.toLowerCase();

    // Check delimiters
    if (trimmedLower === '&' || trimmedLower === 'and') {
      translatedTokens.push('और');
      continue;
    }
    if (trimmedLower === '/') {
      translatedTokens.push('/');
      continue;
    }
    if (trimmedLower === '-') {
      translatedTokens.push('-');
      continue;
    }

    // Check word dictionary
    if (WORD_DICTIONARY[trimmedLower]) {
      translatedTokens.push(WORD_DICTIONARY[trimmedLower]);
      continue;
    }

    // Strip punctuation for lookup
    const cleanWord = trimmedLower.replace(/[^a-z0-9]/g, '');
    if (WORD_DICTIONARY[cleanWord]) {
      translatedTokens.push(WORD_DICTIONARY[cleanWord]);
      continue;
    }

    // If pure number or code, preserve as-is
    if (/^[0-9]+(\.[0-9]+)?$/.test(cleanWord) || /^[A-Z0-9]+$/.test(token)) {
      translatedTokens.push(token);
      continue;
    }

    // Transliterate unfamiliar word
    const transliterated = transliterateWord(cleanWord);
    translatedTokens.push(transliterated);
    usedTransliteration = true;
  }

  const suggestion = translatedTokens.join('').replace(/\s+/g, ' ').trim();

  return {
    suggestion: suggestion || cleanDisplay,
    isTransliterated: usedTransliteration,
    confidence: usedTransliteration ? 'medium' : 'high',
  };
}
