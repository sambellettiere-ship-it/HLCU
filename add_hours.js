const fs = require('fs');

const files = [
  'account.html',
  'archive.html',
  'showcase.html'
]; 

const hoursHtml = `        <div class="footer__col">
          <h4>Hours</h4>
          <p style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.6;">
            Mon &ndash; Wed: Closed<br>
            Thu &ndash; Fri: 6&ndash;10 PM<br>
            Saturday: 12&ndash;10 PM<br>
            Sunday: 12&ndash;6 PM
          </p>
        </div>`;

files.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    
    if (content.includes('<h4>Hours</h4>')) return;
    
    // using regex to find <div class="footer__col">\s*<h4>Contact</h4>
    const regex = /(<div class="footer__col">\s*<h4>Contact<\/h4>)/;
    if (regex.test(content)) {
      content = content.replace(regex, hoursHtml + '\n        $1');
      fs.writeFileSync(file, content);
      console.log(`Updated ${file}`);
    } else {
      console.log(`Could not find target string in ${file}`);
    }
  }
});
