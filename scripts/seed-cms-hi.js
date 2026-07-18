/**
 * Seed Hindi (hi) CMS content via the admin API, so the storefront has usable
 * Hindi copy out of the box. Mirrors seed-cms.js (login -> PATCH loop) but targets
 * the locale-suffixed keys (cmsHero_hi, ...).
 *
 * These docs are SPARSE by design: only translated TEXT fields are set. Images,
 * links and any field left out inherit English via the serving overlay
 * (getPublicSettings: defaults <- English <- locale, with per-field fallback).
 * So arrays are only included when their text is fully translated here; nested
 * objects with images are omitted and fall back to English.
 *
 * Requires the cms*_hi keys to be whitelisted (config/locales.js + CMS_KEYS) —
 * already done. Idempotent (upsert by key).
 *
 * Usage: node backend/scripts/seed-cms-hi.js   (server must be running)
 */

const BASE_URL = process.env.API_URL || "http://localhost:5000/api";
const ADMIN_EMAIL = "admin@cleanse.com";
const ADMIN_PASSWORD = "Admin@123";

// Bare-key -> Hindi (sparse) payload. The script PATCHes `${key}_hi`.
const sectionsHi = {
  promoBanner: {
    messages: [
      "100% प्राकृतिक सामग्री",
      "₹1200 से अधिक के ऑर्डर पर मुफ़्त शिपिंग",
      "आयुर्वेदिक और डॉक्टर द्वारा प्रमाणित",
    ],
  },
  cmsHero: {
    title: "क्लेंज़ आयुर्वेद",
    subtitle: "सजग जीवन के लिए प्राकृतिक त्वचा देखभाल",
    ctaText: "अभी खरीदें",
  },
  cmsFormula: {
    tagline:
      "हम केवल बोतलें नहीं बेचते; हम शुद्धता तक पहुँचने का एक चिकित्सकीय रूप से प्रमाणित मार्ग देते हैं।",
  },
  cmsMarquee: {
    marqueeLines: [
      "प्राचीन ज्ञान, आधुनिक सुंदरता",
      "चमकती त्वचा के लिए शुद्ध सामग्री",
      "चमकती त्वचा के लिए कालातीत अनुष्ठान",
    ],
    sectionHeader: "ट्रेंडिंग देखें",
  },
  cmsBento: {
    sectionTitle: "आपकी त्वचा सर्वश्रेष्ठ की हकदार क्यों है?",
    ratingText: "4+ स्टार रेटिंग",
  },
  cmsCta: {
    heading: "प्राचीन रहस्य, आधुनिक चमक",
    description: "हल्दी और गुलाब की पंखुड़ियों से समृद्ध।",
    ctaText: "अभी खरीदें",
  },
  cmsPeelReveal: {
    heading: "प्राचीन रहस्य, आधुनिक चमक",
    headerTexts: ["अनुष्ठान: पवित्र", "सूत्र: शुद्ध"],
    footerText: "स्रोत: हिमालयी",
    introTexts: ["अभी", "खरीदें"],
  },
  cmsRitualBanner: {
    heading: "अपना अनुष्ठान खोजें",
    subtitle:
      "त्वचा की देखभाल, धीमे। दो शांत अनुष्ठान — एक सुबह का स्वागत, एक रात की विदाई, प्रत्येक क्लेंज़ से बना।",
    ctaText: "पूरा अनुष्ठान देखें",
  },
  cmsWardrobe: {
    spotlightTitle: "आयुर्वेदिक देखभाल, वास्तविक परिणाम",
    spotlightCtaText: "कलेक्शन खरीदें",
    sideTitle: "चिकित्सकीय रूप से समर्थित, आयुर्वेद में निहित",
    sideCtaText: "अनुष्ठान जानें",
  },
  cmsHeader: {
    navLinks: [
      { label: "होम", href: "/" },
      { label: "शॉप", href: "/wardrobe" },
      { label: "हमारे बारे में", href: "/genesis" },
      { label: "ब्लॉग", href: "/blog" },
    ],
  },
  cmsFooter: {
    navigationLinks: [
      { label: "हेयर केयर", href: "/wardrobe?category=Hair Care" },
      { label: "बॉडी केयर", href: "/wardrobe?category=Body Care" },
      { label: "फेस केयर", href: "/wardrobe?category=Face Care" },
      { label: "हमारे बारे में", href: "/genesis" },
    ],
    supportLinks: [
      { label: "संपर्क करें", href: "/touchpoint" },
      { label: "शिपिंग", href: "/shipping" },
      { label: "रिटर्न", href: "/returns" },
    ],
    copyrightText: "2026 क्लेंज़ आयुर्वेद . सर्वाधिकार सुरक्षित",
  },
  cmsGenesis: {
    heroEyebrow: "हमारी उत्पत्ति",
    heroTitle: "आपके अनुष्ठान के पीछे की कहानी",
    heroSubtitle: "प्राचीन ज्ञान, आधुनिक शुद्धता। प्रकृति से ली गई सुंदरता।",
    leadEyebrow: "दर्शन",
    leadTitle: "सुंदरता प्रकृति से बहनी चाहिए, कभी थोपी नहीं, केवल प्रकट की गई।",
    pillarsTitle: "हर बोतल में चार सिद्धांत",
    heritageTitle: "हिमालय की तलहटी में जन्मी",
    journeyTitle: "तलहटी से आपके अनुष्ठान तक",
    quoteText:
      "“हम केवल बोतलें नहीं बेच रहे; हम शुद्धता का एक चिकित्सकीय रूप से समर्थित मार्ग दे रहे हैं।”",
  },
  cmsRitualPage: {
    heroBreadcrumb: "द रिचुअल",
    heroTitle: "द रिचुअल",
    heroSubtitle:
      "त्वचा की देखभाल, धीमे। आयुर्वेद द्वारा निर्देशित और क्लेंज़ से बना, चेहरे और स्वयं की देखभाल का एक दैनिक समारोह।",
    philosophyEyebrow: "समारोह के रूप में आत्म-देखभाल",
    philosophyStatement:
      "अनुष्ठान एक दिनचर्या नहीं है। यह कुछ ईमानदार मिनट हैं जो आप स्वयं को लौटाते हैं — साँस लेने, अपनी त्वचा को इरादे से छूने, और बाकी काम प्रकृति पर छोड़ने के लिए।",
    pauseTitle: "साँस लें। यह क्षण आपका है।",
    shopTitle: "अपना अनुष्ठान बनाएं",
    quoteText: "“प्रकृति जल्दबाज़ी नहीं करती, फिर भी सब कुछ पूरा होता है।”",
    quoteAuthor: "आयुर्वेदिक ज्ञान",
  },
  cmsShipping: {
    breadcrumbLabel: "शिपिंग",
    heroTitle: "शिपिंग",
    subtitle: "हम कहाँ भेजते हैं, कितना समय लगता है, और कितना खर्च होता है।",
    sections: [
      {
        heading: "ऑर्डर प्रोसेसिंग",
        body: "ऑर्डर देने के 2-3 कार्य दिवसों के भीतर पैक और भेज दिए जाते हैं।\n\nसप्ताहांत या सार्वजनिक अवकाश पर दिए गए ऑर्डर अगले कार्य दिवस पर संसाधित होते हैं।",
      },
      {
        heading: "डिलीवरी समय",
        body: "भेजे जाने के बाद, भारत में डिलीवरी 5-7 दिन और अंतरराष्ट्रीय ऑर्डर के लिए 10-14 दिन लेती है।\n\nये कूरियर के अनुमान हैं, गारंटी नहीं — दूरस्थ पिन कोड और सीमा शुल्क में समय लग सकता है।",
      },
      {
        heading: "शिपिंग शुल्क",
        body: "भारत में ₹1200 से अधिक के सभी ऑर्डर पर शिपिंग मुफ़्त है।\n\nअंतरराष्ट्रीय शिपिंग की गणना चेकआउट पर आपके स्थान के आधार पर की जाती है, इसलिए भुगतान से पहले आपको सटीक लागत दिखेगी।",
      },
      {
        heading: "हम कहाँ भेजते हैं",
        body: "हम दुनिया भर में भेजते हैं।\n\nआपके देश द्वारा लगाए गए किसी भी सीमा शुल्क या आयात कर उस देश द्वारा निर्धारित होते हैं और डिलीवरी पर आपके द्वारा देय होते हैं।",
      },
      {
        heading: "अपना ऑर्डर ट्रैक करें",
        body: "आप अपने खाते के ऑर्डर पेज से हर ऑर्डर की स्थिति देख सकते हैं।\n\nयदि आपकी डिलीवरी में कुछ गलत लगे, तो हमारे संपर्क पेज के माध्यम से संपर्क करें और हम इसकी जाँच करेंगे।",
      },
    ],
  },
  cmsReturns: {
    breadcrumbLabel: "रिटर्न",
    heroTitle: "रिटर्न",
    subtitle: "हमारी रिटर्न अवधि, इसे कैसे शुरू करें, और रिफंड कैसे काम करते हैं।",
    sections: [
      {
        heading: "हमारी रिटर्न अवधि",
        body: "हम बिना खुले उत्पादों पर 7-दिन की रिटर्न नीति देते हैं, जो आपके ऑर्डर की डिलीवरी के दिन से गिनी जाती है।",
      },
      {
        heading: "हम क्या स्वीकार कर सकते हैं",
        body: "उत्पाद बिना खुले और अपनी मूल पैकेजिंग में, सील बरकरार होने चाहिए।\n\nचूँकि ये सीधे शरीर पर लगाए जाने वाले स्किनकेयर उत्पाद हैं, हम खुले हुए आइटम को दोबारा नहीं बेच सकते — इसलिए खुले उत्पाद रिटर्न अवधि से बाहर हैं।",
      },
      {
        heading: "रिटर्न कैसे शुरू करें",
        body: "अपने खाते में ऑर्डर पेज खोलें और जिस ऑर्डर को वापस भेजना है उस पर रिटर्न / रिफंड चुनें।\n\nआप हमारे संपर्क पेज के माध्यम से हमारी सहायता टीम तक भी पहुँच सकते हैं और हम इसे आपके लिए शुरू करेंगे।",
      },
      {
        heading: "रिफंड",
        body: "एक बार आपका रिटर्न स्वीकृत हो जाने पर, हम रिफंड शुरू करते हैं और ऑर्डर रिफंडेड की ओर बढ़ता है।\n\nआप इन चरणों को ऑर्डर पेज से देख सकते हैं, ताकि आपको हमेशा पता रहे कि आपका रिफंड कहाँ पहुँचा है।",
      },
      {
        heading: "क्षतिग्रस्त या गलत आइटम",
        body: "यदि आपका ऑर्डर क्षतिग्रस्त पहुँचता है, या वह नहीं है जो आपने ऑर्डर किया था, तो जल्द से जल्द हमारे संपर्क पेज के माध्यम से संपर्क करें।\n\nआइटम की एक तस्वीर और अपना ऑर्डर नंबर भेजें और हम इसे ठीक करेंगे।",
      },
    ],
  },
};

async function main() {
  console.log("Logging in as admin...");
  const loginRes = await fetch(`${BASE_URL}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) {
    console.error("Login failed:", loginRes.status, await loginRes.text());
    process.exit(1);
  }
  const loginData = await loginRes.json();
  const token = loginData.data?.accessToken || loginData.accessToken;
  if (!token) {
    console.error("No access token:", JSON.stringify(loginData));
    process.exit(1);
  }
  console.log("  ✓ Logged in\n");

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  console.log("Saving Hindi CMS sections...");
  let okCount = 0;
  for (const [baseKey, data] of Object.entries(sectionsHi)) {
    const key = `${baseKey}_hi`;
    process.stdout.write(`  ${key}...`);
    const res = await fetch(`${BASE_URL}/admin/cms/${key}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      console.error(` FAILED (${res.status}): ${await res.text()}`);
      continue;
    }
    okCount++;
    console.log(" ✓");
  }

  console.log("\nVerifying via public settings (?lang=hi)...");
  const pubRes = await fetch(`${BASE_URL}/settings/public?lang=hi`);
  const s = (await pubRes.json()).data || {};
  console.log(`  cmsHero.title:   ${s.cmsHero?.title || "(none)"}`);
  console.log(`  cmsFooter.copyright: ${s.cmsFooter?.copyrightText || "(none)"}`);
  console.log(`  cmsShipping.hero: ${s.cmsShipping?.heroTitle || "(none)"}`);

  console.log(`\n✅ Hindi CMS seed complete (${okCount}/${Object.keys(sectionsHi).length} sections).`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
