const fs = require('fs');

const files = [
  'index.html',
  'about.html',
  'leaderboard.html',
  'calendar.html',
  'pricing.html',
  'contact.html',
  'showcase.html',
  'account.html',
  'archive.html',
  'admin.html'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes('<link rel="icon"')) {
    content = content.replace(
      '  <link rel="stylesheet" href="css/styles.css" />',
      '  <link rel="stylesheet" href="css/styles.css" />\n  <link rel="icon" type="image/svg+xml" href="/logo.svg" />'
    );
    fs.writeFileSync(file, content);
  }
}
