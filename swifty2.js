import fs from "fs/promises";
import fsExtra from "fs-extra";
import path from "path";
import matter from "gray-matter";
import { marked } from "marked";
import yaml from "js-yaml";
import { fileURLToPath } from "url";

// TO DO
// the logic of the homepage needs tightening up
// sibling, parent, child page links
// Have a partial for displaying index pages

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directories
const baseDir = __dirname;
const dirs = {
  pages: path.join(baseDir, 'pages'),
  images: path.join(baseDir, 'images'),
  dist: path.join(baseDir, 'dist'),
  layouts: path.join(baseDir, 'layouts'),
  css: path.join(baseDir, 'css'),
  js: path.join(baseDir, 'js'),
  partials: path.join(baseDir, 'partials'),
};

const tagsMap = new Map();
const addToTagMap = (tag, page) => {
  if (!tagsMap.has(tag)) tagsMap.set(tag, []);
  tagsMap.get(tag).push({ title: page.title, url: page.url });
};

// Valid file extensions for assets
const validExtensions = {
  css: ['.css'],
  js: ['.js'],
  images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'],
};

// Ensure and copy valid assets
const ensureAndCopy = async (source, destination, validExts) => {
  if (await fsExtra.pathExists(source)) {
    await fsExtra.ensureDir(destination);

    const files = await fs.readdir(source);
    await Promise.all(
      files
        .filter(file => validExts.includes(path.extname(file).toLowerCase()))
        .map(file => fsExtra.copy(path.join(source, file), path.join(destination, file)))
    );
    console.log(`Copied valid files from ${source} to ${destination}`);
  } else {
    console.log(`No ${path.basename(source)} found in ${source}`);
  }
};

// Helper function to capitalize words
const capitalize = (str) => str.replace(/\b\w/g, (char) => char.toUpperCase());

// Copy assets with file type validation
const copyAssets = async () => {
  await ensureAndCopy(dirs.css, path.join(dirs.dist, 'css'), validExtensions.css);
  await ensureAndCopy(dirs.js, path.join(dirs.dist, 'js'), validExtensions.js);
  await ensureAndCopy(dirs.images, path.join(dirs.dist, 'images'), validExtensions.images);
};

// Utility: Generate HTML imports for assets
const generateAssetImports = async (dir, tagTemplate, validExts) => {
  if (!(await fsExtra.pathExists(dir))) return '';
  const files = await fs.readdir(dir);
  return files
    .filter(file => validExts.includes(path.extname(file).toLowerCase()))
    .map(file => tagTemplate(file))
    .join('\n');
};

// Generate CSS and JS imports
const getCssImports = () => generateAssetImports(dirs.css, (file) => `<link rel="stylesheet" href="/css/${file}" />`,validExtensions.css);
const getJsImports = () => generateAssetImports(dirs.js, (file) => `<script src="/js/${file}"></script>`,validExtensions.js);

const loadConfig = async (dir) => {
  const configFiles = ['config.yaml', 'config.yml', 'config.json'];
  
  for (const file of configFiles) {
    const filePath = path.join(dir, file);
    try {
      await fs.access(filePath); // Check if file exists
      const content = await fs.readFile(filePath, 'utf-8');
      return file.endsWith('.json') ? JSON.parse(content) : yaml.load(content);
    } catch (err) {
      // File not found, continue to next option
    }
  }
  return {}; // Return an empty object if no config file is found
};

// Default configuration
const defaultConfig = await loadConfig(baseDir);

// Utility: Cache and load layouts
const layoutCache = new Map();
const getLayout = async (layoutName) => {
  if (!layoutName) return null;
  if (!layoutCache.has(layoutName)) {
    const layoutPath = path.join(dirs.layouts, `${layoutName}.html`);
    if (await fsExtra.pathExists(layoutPath)) {
      const layoutContent = await fs.readFile(layoutPath, 'utf-8');
      layoutCache.set(layoutName, layoutContent);
    } else {
      console.warn(`Layout "${layoutName}" not found.`);
      return null;
    }
  }
  return layoutCache.get(layoutName);
};

// Apply layout content to a page
const applyLayout = async (layoutContent, config) => {
  if (!layoutContent) return ['', ''];
  const [before, after] = layoutContent.split(/{{\s*content\s*}}/);
  return [
    await replacePlaceholders(before || '', config),
    await replacePlaceholders(after || '', config),
  ];
};

// Utility: Apply layout and wrap content in a Turbo Frame
const applyLayoutAndWrapContent = async (page,content) => {
  const layoutContent = await getLayout(page.data.layout);
  const [beforeLayout, afterLayout] = await applyLayout(layoutContent, page.data);

  return `
<turbo-frame id="content">
  <head><title>${page.title} || ${page.data.sitename}</title></head>
  ${beforeLayout}
  ${content}
  ${afterLayout}
</turbo-frame>
  `;
};

const isValid = async (filePath) => {
  try {
    const stats = await fs.stat(filePath);
    return stats.isDirectory() || path.extname(filePath) === '.md';
  } catch (err) {
    return false; // Handle errors like file not found
  }
};

const generatePages = async (sourceDir, baseDir = sourceDir, parent) => {
  const pages = [];
  try {
    const files = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const file of files) {
      const filePath = path.join(sourceDir, file.name);
      const valid = await isValid(filePath);
      if(!valid) continue;
      const relativePath = path.relative(baseDir, filePath).replace(/\\/g, "/"); // Normalize slashes
      // Check if the file is "index.md", and if so, set path to "/"
      const finalPath = `/${relativePath.replace(/\.md$/, "")}`;
      const name = path.basename(file.name, path.extname(file.name))

      const stats = await fs.stat(filePath);
      const isDirectory = file.isDirectory();
      const folderConfig = await loadConfig(sourceDir);
      const config = {...defaultConfig,...parent?.data,...folderConfig};

      const page = {
        name,
        path: finalPath,
        filepath: filePath,
        url: (parent ? parent.path : "") + "/" + name + ".html",
        nav: !parent,
        parent: parent ? {title: parent.data.title, url: parent.url} : undefined,
        folder: isDirectory,
        title: capitalize(file.name.replace(/\.md$/, "").replace(/-/g, " ")),
        created_at: new Date(stats.birthtime).toLocaleDateString(undefined,config.dateFormat),
        updated_at: new Date(stats.mtime).toLocaleDateString(undefined,config.dateFormat),
        data: config
      };
      page.data.date = page.updated_at;

      if (file.name === "index.md") {
        page.index = true;
        page.nav = false;
        page.url = "/";
      };

      if (isDirectory) {
        page.data.title = page.name
        page.pages = await generatePages(filePath, baseDir, page);
        page.children = page.pages.map(p => ({title: p.title, url: p.url}));
        page.pages = page.pages.map(p => ({...p, siblings: page.children.filter(child => child.name !== p.name)}));
        page.content = generateIndexPage(page);
      } else if (path.extname(file.name) === ".md") {
        const markdownContent = await fs.readFile(filePath, "utf-8");
        const { data, content } = matter(markdownContent);
        Object.assign(page, { data: { ...page.data, ...data }, content });
        page.data.title =  data.title || page.title
      }

    // add tags
    if (page.data.tags) {
      for (const tag of page.data.tags) {
        addToTagMap(tag, page);
        }
      }

      const generateLink = ({title,url}) => `<a href="${url}" data-turbo-frame="content" data-turbo-action="advance">${title}</a>`
      // add links
      page.data.links_to_tags = page.data.tags && page.data.tags.length
        ? `<div class="tags">${page.data.tags.map(tag => `<a class="tag" href="/tags/${tag}.html" data-turbo-frame="content" data-turbo-action="advance">${tag}</a>`).join``}</div>`
        : "";
      const homeCrumb = `<a class="breadcrumb" href="/" data-turbo-frame="content" data-turbo-action="advance">Home</a>`;
      if(page.name === "posts") console.log("POSTS!!!!!!!!!!!!",page.data)
      page.data.breadcrumbs = page.index ? homeCrumb
        : `${parent ? parent.data.breadcrumbs : homeCrumb} &raquo; <a class="breadcrumb" href="${page.url}" data-turbo-frame="content" data-turbo-action="advance">${page.title}</a>`
        if(page.name === "posts") console.log("POSTS!!!!!!!!!!!!",page.data)
          page.data.link_to_parent = page.parent ? generateLink(page.parent) : "";
      page.data.links_to_children = page.children ? page.children.map(child => generateLink(child)).join`` : "";
      page.data.links_to_siblings = page.siblings ? page.siblings.map(sibling => generateLink(sibling)).join`` : "";
      page.data.links_to_self_and_siblings = page.siblings ? ({...{title: page.data.title, url: page.url},...page.siblings}).map(sibling => generateLink(sibling)).join`` : "";

      pages.push(page);
    }

  } catch (err) {
    console.error("Error reading directory:", err);
  }

  // make Tags page
  if(!parent && tagsMap.size){
    const tagPage = {
        path: "/tags",
        url: "/tags.html",
        nav: false,
        folder: true,
        name: "tags",
        title: "All Tags",
        updated_at: new Date().toLocaleDateString(undefined,defaultConfig.dateFormat),
        data: defaultConfig,
    }
    tagPage.pages = [];
    for (const [tag, pages] of tagsMap) {
      const listItems = pages
          .map(
            page =>
              `<li><a href="${page.url}.html" data-turbo-frame="content" data-turbo-action="advance">${page.title}</a></li>`
          )
          .join('\n')
          const content = `<ul>${listItems}</ul>`;
          const page = { 
            data: {...defaultConfig, title: `Pages tagged with ${capitalize(tag)}`},
            updated_at: new Date().toLocaleDateString(undefined,defaultConfig.dateFormat),
            path: `/tags/${tag}`,
            url:  `/tags/${tag}.html`
          };
          page.content = await applyLayoutAndWrapContent(page, content);
          tagPage.pages.push(page);
    }
    tagPage.content = await render(tagPage,generateIndexPage(tagPage));
    pages.push(tagPage);
  }
  console.log(pages)
  return pages;
};

const generateIndexPage = page => {
  return `
  <ul>
  ${page.pages.map(page => `<li>${page.updated_at}: <a href="${page.url}" data-turbo-frame="content">${page.title}</a></li>`).join``}
  </ul>`
}

const render = async (page, content) => {
  const replacedContent = await replacePlaceholders(content, page.data);
  const htmlContent = marked(replacedContent); // Markdown processed once
  const wrappedContent = await applyLayoutAndWrapContent(page, htmlContent);
  return wrappedContent;
};

// Function to read and render the index template
const renderIndexTemplate = async (homeHtmlContent, config) => {
  // Read the template from pages folder
  const templatePath = path.join(__dirname, 'index.html');
  let templateContent = await fs.readFile(templatePath, 'utf-8');

  // Add the meta tag for Turbo refresh method
  const turboMetaTag = `<meta name="turbo-refresh-method" content="morph">`;
  const css = await getCssImports();
  const js = await getJsImports();
  const imports = css + js;

  templateContent = templateContent.replace('</head>', `${turboMetaTag}\n${imports}\n</head>`);

  const content =   `<turbo-frame id="content">
  ${homeHtmlContent}
  </turbo-frame>`

  // Replace placeholders with dynamic values
  templateContent = await replacePlaceholders(templateContent,{...defaultConfig,...config,content})

  // Add the missing script to the template
  const turboScript = `
<script type="module">
  import * as Turbo from 'https://esm.sh/@hotwired/turbo';

  // Ensure the turbo-frame loads the correct content based on the current URL
  (function() {
    const turboFrame = document.querySelector("turbo-frame#content");
    const path = window.location.pathname;

    // Set the src attribute for the turbo frame
      const pagePath = path.endsWith(".html") ? path : path + ".html";
      turboFrame.setAttribute("src", pagePath);
  })();

  // Update the page title and address bar dynamically
  document.addEventListener("turbo:frame-load", event => {
    const turboFrame = event.target;
    // Update the address bar without appending '/home' for the root
    const frameSrc = turboFrame.getAttribute("src");
    if (frameSrc && frameSrc.endsWith("home.html")) {
      window.history.pushState({}, "", "/");
    } else if (frameSrc && frameSrc.endsWith(".html")) {
      const newPath = frameSrc.replace(".html", "");
      window.history.pushState({}, "", newPath);
    }

    const rootUrl = "/"; // Define the root URL to exclude

    document.querySelectorAll('#content a[href]').forEach(link => {
      const href = link.getAttribute('href');

      // Skip external links and the root URL
      if (
        href.startsWith('#') || // Skip anchor links
        href.startsWith('http') || // Skip external links
        href === rootUrl // Skip the root URL
      ) {
        return;
      }

      // Add Turbo attributes for internal links
      link.setAttribute('data-turbo-frame', 'content');
      link.setAttribute('data-turbo-action', 'advance');
      link.setAttribute('href', href + (href.endsWith(".html") ? "" : ".html"));
    });
  });
</script>
  `;

  // Inject the script at the end of the template
  templateContent = templateContent.replace('</body>', `${turboScript}</body>`);

  return templateContent;
};

const createPages = async (pages, distDir=dirs.dist) => {
  for (const page of pages) {
  let html = await render(page,page.content);
  if(page.index){
      const navLinks = pages.filter(page => page?.nav || page?.data?.nav).map(
      page => `<a href="${page.url}" data-turbo-frame="content" data-turbo-action="advance">${page.title}</a>`).join('\n');
      page.data.nav = `<nav>${navLinks}</nav>`; 
      html = await renderIndexTemplate(html,page.data);
    }
    const pagePath = path.join(distDir, page.index ? "/index.html" : page.url);
    // If it's a folder, create the directory and recurse into its pages
    if (page.folder) {
      if (!(await fsExtra.pathExists(path.join(distDir, page.path)))) {
        await fs.mkdir(path.join(distDir, page.path), { recursive: true });
      }
        // Recurse into pages inside the directory
        await createPages(page.pages); // Process nested pages inside the folder
    }
    // create an HTML file
    try {
      await fs.writeFile(pagePath, html);
      console.log(`Created file: ${pagePath}`);
    } catch (err) {
      console.error(`Error writing file ${pagePath}:`, err);
    }
  }
};

const replacePlaceholders = async (template, values) => {
  const partialRegex = /{{\s*partial:\s*([\w-]+)\s*}}/g;

  // Async replace function
  const replaceAsync = async (str, regex, asyncFn) => {
    const matches = [];
    str.replace(regex, (match, ...args) => {
      matches.push(asyncFn(match, ...args));
      return match;
    });

    const results = await Promise.all(matches);
    return str.replace(regex, () => results.shift());
  };

  // Replace partial includes
  template = await replaceAsync(template, partialRegex, async (match, partialName) => {
    const partialPath = path.join(dirs.partials, `${partialName}.md`);
    if (await fsExtra.pathExists(partialPath)) {
      let partialContent = await fs.readFile(partialPath, "utf-8");
      partialContent = await replacePlaceholders(partialContent, values); // Recursive replacement
      return marked(partialContent); // Convert Markdown to HTML
    } else {
      console.warn(`Include "${partialName}" not found.`);
      return `<p>Include "${partialName}" not found.</p>`;
    }
  });

  // Replace other placeholders **only outside of code blocks**
  template = template.replace(
    /(?<!`{3}[^]*?){{\s*([^}\s]+)\s*}}(?![^]*?`{3})/g,
    (match, key) => (key in values ? values[key] : match)
  );

  return template;
};


// Main function to handle conversion and site generation
const generateSite = async () => {
  console.log('Starting build process...');
  // Copy images, CSS, and JS files
  await copyAssets();
  // Convert markdown in pages directory
  const pages = await generatePages(dirs.pages);
  await createPages(pages);
};

// Run the site generation process
generateSite()
  .then(() => console.log('Site generated successfully!'))
  .catch(err => console.error('Error generating site:', err));