const fs = require('fs');

const files = [
  'about.html',
  'account.html',
  'admin.html',
  'archive.html',
  'calendar.html',
  'contact.html',
  'index.html',
  'leaderboard.html',
  'pricing.html',
  'showcase.html'
]; 

const gtagHtml = `  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-S0XCF64KN7"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    gtag('config', 'G-S0XCF64KN7');
  </script>`;

files.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    
    if (content.includes('G-S0XCF64KN7')) return;
    
    content = content.replace('</head>', gtagHtml + '\n</head>');
    fs.writeFileSync(file, content);
    console.log(`Updated ${file}`);
  }
});
