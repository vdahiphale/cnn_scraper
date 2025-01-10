const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

// Headers for HTTP requests
const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36",
};

// Function to sanitize filenames
const sanitizeFilename = (filename) => {
  return filename.replace(/[<>:"/\\|?*]/g, "-").substring(0, 100);
};

// Function to scrape a CNN article
const scrapeCnnArticle = async (url) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios.get(url, { headers });
      if (response.status === 200) {
        const $ = cheerio.load(response.data);

        const headline =
          $("p.cnnTransStoryHead").text().trim() || "No headline found";
        const subHeadline =
          $("p.cnnTransSubHead").text().trim() || "No sub-headline found";

        const bodyText = $("p.cnnBodyText")
          .map((i, el) => {
            // Use .html() to preserve inline structure and replace <br> with \n
            const htmlContent = $(el).html();
            return htmlContent
              ? htmlContent.replace(/<br\s*\/?>/gi, "\n").trim() // Replace <br> tags with \n
              : $(el).text().trim(); // Fallback to plain text
          })
          .get()
          .join("\n"); // Join paragraphs with newline characters

        return {
          headline,
          subHeadline,
          bodyText: bodyText || "No body text found",
        };
      } else {
        console.log(
          `Attempt ${attempt + 1} failed with status code: ${response.status}`
        );
        await new Promise((r) => setTimeout(r, 2000)); // Wait before retrying
      }
    } catch (error) {
      console.log(`Attempt ${attempt + 1} failed with error: ${error.message}`);
      await new Promise((r) => setTimeout(r, 2000)); // Wait before retrying
    }
  }
  return { error: "Failed to retrieve the article after multiple attempts" };
};

// Directories for saving files
const transcriptFolder = "cnn_transcripts_text";
const htmlFolder = "cnn_transcripts_html";
fs.mkdirSync(transcriptFolder, { recursive: true });
fs.mkdirSync(htmlFolder, { recursive: true });

// Fixed start date
let currentDate = new Date("2021-06-30");

console.log("Started scraping CNN transcripts from 2021-06-30 backward");

(async () => {
  while (true) {
    const dateStr = currentDate.toISOString().split("T")[0];
    const baseUrl = `https://transcripts.cnn.com/date/${dateStr}`;

    try {
      const response = await axios.get(baseUrl, { headers });
      if (response.status !== 200) {
        console.log(
          `No transcripts available for ${dateStr} or failed to access page.`
        );
      } else {
        const $ = cheerio.load(response.data);
        console.log(`Scraping transcripts for date: ${dateStr}`);

        const transcriptLinks = $("div.cnnSectBulletItems a");
        if (!transcriptLinks.length) {
          console.log(`No transcripts found on the page for ${dateStr}.`);
        } else {
          for (const link of transcriptLinks) {
            const headline = $(link).text().trim();
            const headlineUrl = $(link).attr("href");
            const articleUrl = new URL(headlineUrl, baseUrl).href;

            const filename =
              sanitizeFilename(`${dateStr} - ${headline}`) + ".txt";
            const htmlFilename =
              sanitizeFilename(`${dateStr} - ${headline}`) + ".html";

            const articleData = await scrapeCnnArticle(articleUrl);

            if (articleData.error) {
              console.log(`Error scraping article: ${articleData.error}`);
            } else {
              // Prepare HTML content with preserved newlines
              const htmlContent = `
                <html>
                  <head><title>${articleData.headline}</title></head>
                  <body>
                    <h1>${articleData.headline}</h1>
                    <h2>${articleData.subHeadline}</h2>
                    <pre>${articleData.bodyText}</pre> <!-- Preserves newlines -->
                  </body>
                </html>
              `;

              // Prepare text content with newline characters
              const articleText = `Headline: ${articleData.headline}\nSub-headline: ${articleData.subHeadline}\n\n${articleData.bodyText}`;

              // Save HTML file
              const htmlFilePath = path.join(htmlFolder, htmlFilename);
              fs.writeFileSync(htmlFilePath, htmlContent, "utf8");
              console.log(`Saved HTML transcript to: ${htmlFilePath}`);

              // Save text file
              const textFilePath = path.join(transcriptFolder, filename);
              fs.writeFileSync(textFilePath, articleText, "utf8");
              console.log(`Saved text transcript to: ${textFilePath}`);
            }

            // Be polite with requests
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
    } catch (error) {
      console.log(
        `Error accessing the CNN transcript page for ${dateStr}: ${error.message}`
      );
    }

    // Move to the previous day
    currentDate.setDate(currentDate.getDate() - 1);
  }
})();
