const fs = require('fs-extra');
const path = require('path');
const { marked } = require('marked');

// Paths for source and destination directories
const pagesDir = path.join(__dirname, 'pages');
const distDir = path.join(__dirname, 'dist');

// Default configuration
const defaultConfig = {
  title: 'My Swifty Site',
  author: null,
  dates: false,
};

// Ensure dist directory exists
fs.ensureDirSync(distDir);

// Utility function to capitalize strings
const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

// Function to read configuration JSON for a specific folder and merge with the parent config
const readMergedConfig = async (folderPath, parentConfig = {}) => {
  const folderConfigPath = path.join(folderPath, 'config.json');
  let folderConfig = { ...defaultConfig, ...parentConfig };

  if (await fs.pathExists(folderConfigPath)) {
    const folderSpecificConfig = await fs.readJson(folderConfigPath);
    folderConfig = { ...folderConfig, ...folderSpecificConfig };
  }

  return folderConfig;
};

// Function to convert markdown files to turbo-frame-wrapped HTML
const convertMarkdownToTurboFrame = async (sourceDir, outputDir, parentTitle = null, parentConfig = {}) => {
  if (!(await fs.pathExists(sourceDir))) return [];

  const files = await fs.readdir(sourceDir);
  const links = [];

  // Read and merge config for the current folder
  const folderConfig = await readMergedConfig(sourceDir, parentConfig);

  for (const file of files) {
    const filePath = path.join(sourceDir, file);

    if ((await fs.stat(filePath)).isDirectory()) {
      // Handle subfolder
      const folderName = file;
      const outputFolder = path.join(outputDir, folderName);
      fs.ensureDirSync(outputFolder);

      const folderLinks = await convertMarkdownToTurboFrame(
        path.join(sourceDir, folderName),
        outputFolder,
        folderName,
        folderConfig
      );

      // Create folder index page
      const folderIndexFilePath = path.join(outputDir, `${folderName}.html`);
      await generateFolderIndex(folderIndexFilePath, folderName, folderLinks);

      links.push({ title: capitalize(folderName), path: `/${folderName}` });
    } else if (path.extname(file) === '.md') {
      // Handle markdown file
      const markdownContent = await fs.readFile(filePath, 'utf-8');
      const htmlContent = marked(markdownContent);
      const humanReadableTitle = path
        .basename(file, '.md')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());

      const stats = await fs.stat(filePath);
      const createdDate = new Date(stats.birthtime).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });

      // Get values from the merged config
      const author = folderConfig.author || null;
      const showDate = folderConfig.dates === true;  // If dates is explicitly set to "true", show date
      const backlink = parentTitle
        ? `<p><a href="/${parentTitle}.html" data-turbo-frame="content" data-turbo-action="advance">Back to ${capitalize(
            parentTitle
          )}</a></p>`
        : '';

      // Only include author if it exists
      const infoLine = author
      ? `<p>Posted by ${author}${showDate ? ` on ${createdDate}` : ''}</p>`
      : '';

      const wrappedContent = `
<turbo-frame id="content">
  ${backlink}
  <h1>${humanReadableTitle}</h1>
  ${infoLine}
  ${htmlContent}
</turbo-frame>
      `;

      const outputFilePath = path.join(outputDir, `${path.basename(file, '.md')}.html`);
      await fs.writeFile(outputFilePath, wrappedContent);

      links.push({ title: humanReadableTitle, path: `${parentTitle ? `/${parentTitle}` : ''}/${path.basename(file, '.md')}` });
    }
  }

  return links;
};

// Function to generate folder index HTML
const generateFolderIndex = async (filePath, folderName, links) => {
  const content = `
<turbo-frame id="content">
  <h1>${capitalize(folderName)}</h1>
  <ul>
    ${links
      .map(
        (link) =>
          `<li><a href="${link.path}.html" data-turbo-frame="content" data-turbo-action="advance">${link.title}</a></li>`
      )
      .join('\n')}
  </ul>
</turbo-frame>
  `;

  await fs.writeFile(filePath, content);
};

// Function to generate the main navigation HTML
const generateNavigation = (links) => {
  // Remove "home" from links to avoid duplicate entry
  const filteredLinks = links.filter(link => link.title.toLowerCase() !== 'home');

  const homeLink = `<li><a href="/" data-turbo-frame="content" data-turbo-action="advance">Home</a></li>`;
  const otherLinks = filteredLinks
    .map(
      (link) =>
        `<li><a href="${link.path}.html" data-turbo-frame="content" data-turbo-action="advance">${link.title}</a></li>`
    )
    .join('\n');

  return `
<nav>
  <ul>
    ${homeLink} <!-- Add Home link once at the top -->
    ${otherLinks}
  </ul>
</nav>
  `;
};

// Main function to handle conversion and site generation
const generateSite = async () => {
  // Start with default config
  const siteConfig = await readMergedConfig(pagesDir);

  const siteTitle = siteConfig.title || defaultConfig.title;

  // Convert markdown in pages directory
  const pageLinks = await convertMarkdownToTurboFrame(pagesDir, distDir, null, siteConfig);

  // Generate navigation
  const navigation = generateNavigation(pageLinks);

  // Read home.md file and generate home page content
  const homeFilePath = path.join(pagesDir, 'home.md');
  const homeContent = await fs.readFile(homeFilePath, 'utf-8');
  const homeHtmlContent = marked(homeContent);

  // Generate index.html
  const indexFilePath = path.join(distDir, 'index.html');
  const indexContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdn.simplecss.org/simple.min.css">
  <title>${siteTitle}</title>
</head>
<body>
  <header>
  ${navigation}
      <h1>${siteTitle}</h1>
  </header>
    <main>
  <turbo-frame id="content">${homeHtmlContent}</turbo-frame>
  </main>
    <footer>
    Run <code>npm run build</code> to build the pages in the dist folder.
    Run <code>npm start</code> to start a local server.
  </footer>
  <script type="module">
    import * as Turbo from 'https://esm.sh/@hotwired/turbo';

    document.addEventListener("turbo:frame-load", (event) => {
      const frameSrc = event.target.getAttribute("src");
      if (frameSrc && frameSrc.endsWith("home.html")) {
        window.history.pushState({}, "", "/");
      } else if (frameSrc && frameSrc.endsWith(".html")) {
        const newPath = frameSrc.replace(".html", "");
        window.history.pushState({}, "", newPath);
      }
    });
  </script>
</body>
</html>
  `;
  await fs.writeFile(indexFilePath, indexContent);
};

// Run the site generation
generateSite()
  .then(() => console.log('Site generated successfully'))
  .catch((err) => console.error('Error generating site:', err));
