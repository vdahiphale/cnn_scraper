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

        const bodyElements = $("p.cnnBodyText");
        const bodyText = bodyElements
          .map((i, el) => {
            const htmlContent = $(el).html();
            return htmlContent
              ? htmlContent
                  .replace(/<br\s*\/?>(?!(\[\d{2}:\d{2}:\d{2}\]))/gi, "\n")
                  .trim() // Replace <br> tags except those before timestamps
              : $(el).text().trim();
          })
          .get()
          .join("\n");

        // Extract speaker utterances
        const utterances = [];
        let currentSpeaker = null;
        let currentTimestamp = null;
        let currentSentences = "";

        bodyElements.each((i, el) => {
          const text = $(el).html();
          const parts = text
            .split(/<br>/)
            .map((item) => item.trim())
            .filter((item) => item !== "");
          for (const str of parts) {
            if (/^\[\d{2}:\d{2}:\d{2}\]$/.test(str)) {
              currentTimestamp = str.slice(1, -1); // Remove brackets
              currentSpeaker = null;
              currentSentences = "";
            } else {
              if (/^[A-Z ,]+:/.test(str)) {
                // Push the last utterance
                if (currentSpeaker && currentSentences) {
                  utterances.push({
                    timeStamp: currentTimestamp,
                    speaker: currentSpeaker,
                    sentences: currentSentences.trim(),
                    isLastSentenceInterrupted: false,
                  });
                  currentSentences = "";
                }
                const textSplitted = str.split(":");
                currentSpeaker = textSplitted[0].trim();
                currentSentences = textSplitted[1].trim();
              } else {
                currentSentences += str + " ";
              }
            }
          }
        });

        return {
          headline,
          subHeadline,
          bodyText: bodyText || "No body text found",
          utterances,
        };
      } else {
        console.log(
          `Attempt ${attempt + 1} failed with status code: ${response.status}`
        );
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (error) {
      console.log(`Attempt ${attempt + 1} failed with error: ${error.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return { error: "Failed to retrieve the article after multiple attempts" };
};

// Directories for saving files
const transcriptFolder = "cnn_transcripts_text";
const htmlFolder = "cnn_transcripts_html";
const utterancesFolder = "cnn_transcripts_utterances";
fs.mkdirSync(transcriptFolder, { recursive: true });
fs.mkdirSync(htmlFolder, { recursive: true });
fs.mkdirSync(utterancesFolder, { recursive: true });

// Fixed start date
let currentDate = new Date("2025-01-09");

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
            const utterancesFilename =
              sanitizeFilename(`${dateStr} - ${headline}`) + ".json";

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
                    <pre>${articleData.bodyText}</pre>
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

              // Save utterances to JSON file
              const utterancesFilePath = path.join(
                utterancesFolder,
                utterancesFilename
              );
              const jsonTranscript = {
                date: dateStr,
                headline: articleData.headline,
                subHeadline: articleData.subHeadline,
                utterances: articleData.utterances,
              };
              fs.writeFileSync(
                utterancesFilePath,
                JSON.stringify(jsonTranscript, null, 2),
                "utf8"
              );
              console.log(`Saved utterances to: ${utterancesFilePath}`);
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
