require("dotenv").config();
const { exit } = require("process");
const puppeteer = require("puppeteer");
const fs = require("fs");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const data = require("./config.json");

const { EMAIL: email, PASSWORD: password } = process.env;

const {
  locale,
  baseURL,
  keyword,
  workPlaceTypes,
  location,
  AvgExperience,
  periodOfTime,
  browserPath,
  resolution,
  numberOfJobsPerPage,
  avoidJobTitles,
  avoidCompanies,
  startPage = 2  // Add this line
} = data;

const t = require(`./i18n/${locale}.json`);

let page = "";
let browser = "";
let csvWriter = null;

function logs() {
  console.clear();
  console.log("\n==========================================\n");
  console.log(`\t${t.appTitle}`);
  console.log("\n==========================================\n");
}

async function login() {
  // Check if already logged in by looking for the sign-in button
  const isLoggedIn = await page.evaluate(() => {
    return !document.querySelector('[data-tracking-control-name="guest_homepage-basic_sign-in-button"]');
  });

  if (!isLoggedIn) {
    await findTargetAndType('[name="session_key"]', email);
    await findTargetAndType('[name="session_password"]', password);
    await page.keyboard.press("Enter");
    await page.waitForNavigation();
  }
}

async function initializer() {
  browser = await puppeteer.launch({
    headless: false,
    executablePath: browserPath,
    args: [resolution],
    defaultViewport: null,
    timeout: 60000,
    userDataDir: "./userData"  // Enable persistent session storage
  });
  page = await browser.newPage();
  const pages = await browser.pages();
  if (pages.length > 1) {
    await pages[0].close();
  }
  await page.goto(baseURL);

  csvWriter = createCsvWriter({
    path: "report.csv",
    header: [
      { id: "jobTitle", title: "Job Title" },
      { id: "link", title: "Link" },
      { id: "status", title: "Status" },
    ],
  });
}

async function findTargetAndType(target, value) {
  const f = await page.$(target);
  await f.type(value);
}

async function waitForSelectorAndType(target, value) {
  const typer = await page.waitForSelector(target, { visible: true });
  await typer.type(value);
}

async function clickElement(selector, timeout = 10000) {
  try {
    await page.waitForSelector(selector, { timeout });
    const element = await page.$(selector);
    if (element) {
      // Scroll element into view before clicking
      await page.evaluate(el => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, element);
      await pause(1000);
      await element.click();
      return true;
    }
  } catch (error) {
    console.warn(`Warning: Could not click "${selector}": ${error.message}`);
    // Try alternate click method
    try {
      await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (element) element.click();
      }, selector);
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

const pause = async (ms = 3000) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

async function filterByKeywords() {
  const searchBox = "#global-nav > div > nav > ul > li:nth-child(3)";
  await clickElement(searchBox);
  await pause();
  await waitForSelectorAndType(
    '[id^="jobs-search-box-keyword-id"]',
    keyword.join(" OR ")
  );
}

async function filterByLocation() {
  const jobLocationSelector = '[id^="jobs-search-box-location-id"]';
  await page.evaluate((selector) => {
    const locationSelector = document.querySelector(selector);
    if (locationSelector) locationSelector.value = "";
  }, jobLocationSelector);

  await waitForSelectorAndType(jobLocationSelector, location);
}

async function getEasyApplySelector() {
  const possibleSelectors = [
    'button[aria-label="Easy Apply filter"]',
    'button[aria-label="Easy Apply filter."]',
    '[type="checkbox"][name="f_LF"]',
    '.search-reusables__filter-binary-toggle'
  ];

  for (const selector of possibleSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      return selector;
    } catch (error) {
      continue;
    }
  }
  console.warn('Easy Apply filter not found, continuing without it...');
  return null;
}

const easyApplyFilter = async () => {
  try {
    const selector = await getEasyApplySelector();
    if (selector) {
      await clickElement(selector);
      await pause();
    }
  } catch (error) {
    console.error(`Error applying Easy Apply filter: ${error.message}`);
    // Continue execution even if Easy Apply filter fails
  }
};

async function filterByTime() {
  try {
    await pause(3000);

    // Try multiple selectors for opening the time filter
    const timeFilterSelectors = [
      'button[aria-label="Date posted filter"]',
      'button[aria-label="Date posted filter."]',
      '[data-test-filters-time-filter-button]',
      '[aria-label*="Time filter"]',
      'button.search-reusables__filter-pill',
      'button[aria-label*="date posted"]'
    ];

    let filterOpened = false;
    for (const selector of timeFilterSelectors) {
      try {
        const element = await page.waitForSelector(selector, { timeout: 5000 });
        if (element) {
          await element.click();
          filterOpened = true;
          await pause(2000);
          break;
        }
      } catch (error) {
        continue;
      }
    }

    if (!filterOpened) {
      // Try finding the filter by text content
      await page.evaluate(() => {
        const elements = [...document.querySelectorAll('button')];
        const dateButton = elements.find(el => 
          el.textContent.toLowerCase().includes('date posted') ||
          el.textContent.toLowerCase().includes('time posted')
        );
        if (dateButton) dateButton.click();
      });
      await pause(2000);
    }

    // Try to select "Past 24 hours" using the artdeco-button__text class
    const selected = await page.evaluate(() => {
      const options = Array.from(document.querySelectorAll('.artdeco-button__text'));
      const pastDayOption = options.find(el => 
        el.textContent.trim().toLowerCase().includes('past 24 hours') ||
        el.textContent.trim().toLowerCase().includes('past day')
      );
      if (pastDayOption) {
        pastDayOption.closest('button').click();
        return true;
      }
      return false;
    });

    if (!selected) {
      // Fallback to other selectors if artdeco-button__text didn't work
      const timeOptions = [
        '[for="timePostedRange-r86400"]',
        'input[value="r86400"]',
        '[aria-label*="Past 24 hours"]',
        '[type="radio"][value="r86400"]'
      ];

      for (const selector of timeOptions) {
        try {
          const element = await page.waitForSelector(selector, { timeout: 3000 });
          if (element) {
            await element.click();
            break;
          }
        } catch (error) {
          continue;
        }
      }
    }

    await pause(2000);

    // Click show results button
    const showResultsSelectors = [
      'button.artdeco-button--primary',
      'button[data-test-filters-apply-button]',
      '.artdeco-modal__actionbar button:last-child',
      'button.search-reusables__secondary-filters-show-results-button'
    ];

    for (const selector of showResultsSelectors) {
      try {
        const element = await page.waitForSelector(selector, { timeout: 3000 });
        if (element) {
          await element.click();
          await pause(3000);
          break;
        }
      } catch (error) {
        continue;
      }
    }

    // Verify filter application
    const isFilterApplied = await page.evaluate(() => {
      const pillTexts = Array.from(document.querySelectorAll('.search-reusables__filter-pill'))
        .map(pill => pill.textContent.toLowerCase());
      
      const hasDatePill = pillTexts.some(text => 
        text.includes('24') || 
        text.includes('past day') || 
        text.includes('hour')
      );

      const hasDateInUrl = window.location.href.includes('f_TPR=r86400');

      return hasDatePill || hasDateInUrl;
    });

    if (!isFilterApplied) {
      throw new Error('Date filter not applied');
    }

  } catch (error) {
    console.warn('Error in filterByTime:', error.message);
    // Continue with search even if filter fails
    console.log('Proceeding with available search results...');
  }
}

async function filterByType() {
  await clickElement(".search-reusables__filter-list>li:nth-child(8)>div");
  await pause(2000);

  for (const selector of Object.values(workPlaceTypes)) {
    await clickElement(selector);
  }

  await pause(2000);
  const showResultsBtn =
    ".search-reusables__filter-list>li:nth-child(8)>div>div>div>div>div>form>fieldset>div+hr+div>button+button";
  await clickElement(showResultsBtn);
}

async function Scrolling() {
  console.log(`\n${t.scroll}.....`);
  try {
    await page.evaluate(() => {
      const listOfJobs = document.querySelector(
        "div.scaffold-layout__list > div > ul"
      );
      if (listOfJobs) {
        listOfJobs.scrollIntoView();
      } else {
        console.error(`${t.el404Scroll}.`);
      }
    });
  } catch (error) {
    console.error(`${t.errorOnScroll}: \n${error}`);
  }
}

function changeValue(input, value) {
  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  nativeInputValueSetter.call(input, value);
  var inputEvent = new Event("input", { bubbles: true });
  input.dispatchEvent(inputEvent);
}

function writeInCSV(data) {
  csvWriter
    .writeRecords([data])
    .then(() => {
      console.log(`${t.csvSuccess}\n`);
    })
    .catch((error) => {
      console.error(`${t.csvError}: \n${error}`);
    });
}

async function getCompanyName() {
  const companyNameSelector =
    ".job-details-jobs-unified-top-card__company-name>a";

  const companyName = await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    return element ? element.text : null;
  }, companyNameSelector);

  return companyName;
}

async function getJobTitle() {
  const jobTitleSelector = ".job-details-jobs-unified-top-card__job-title>h1>a";

  const jobTitle = await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    return element ? element.text : null;
  }, jobTitleSelector);

  return jobTitle;
}

async function getLink() {
  const jobLinkSelector = ".job-details-jobs-unified-top-card__job-title>h1>a";

  const jobLink = await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    return element ? element.href : null;
  }, jobLinkSelector);

  return jobLink;
}

const getTotalJobResult = async () => {
  try {
    // Wait for the element to be available
    await page.waitForSelector("[class*='jobs-search-results-list__subtitle']", { timeout: 5000 });
    
    const jobResultString = await page.evaluate(() => {
      const el = document.querySelector("[class*='jobs-search-results-list__subtitle']");
      if (!el) return "0";
      const text = el.innerText || "0";
      return text.split(" ")[0] || "0";
    });
    
    return jobResultString.split(",").join("") || "0";
  } catch (error) {
    console.warn("Could not get total job count:", error.message);
    return "0"; // Return safe default
  }
};

const closeJobApplicationDialog = async () => {
  await pause();
  await page.evaluate(() => {
    const xBtn = document.querySelector(
      ".artdeco-modal__dismiss.artdeco-button.artdeco-button--circle.artdeco-button--muted.artdeco-button--2.artdeco-button--tertiary.ember-view"
    );
    if (xBtn) xBtn.click();
  });
};

const getNextButton = async () => {
  try {
    // Wait for the pagination container to load
    await page.waitForSelector('.artdeco-pagination', { timeout: 5000 });

    // Handle numbered pagination
    const nextButton = await page.evaluate(() => {
      const paginationItems = document.querySelectorAll('.artdeco-pagination__pages .artdeco-pagination__indicator');
      const activePage = Array.from(paginationItems).find(item => item.classList.contains('active'));
      
      if (activePage) {
        const nextPage = activePage.nextElementSibling;
        if (nextPage && nextPage.tagName === 'LI') {
          const nextButton = nextPage.querySelector('button');
          if (nextButton && !nextButton.disabled) {
            return nextButton.getAttribute('aria-label');
          }
        }
      }
      return null;
    });

    if (nextButton) {
      return `button[aria-label="${nextButton}"]`;
    }

    // Fallback to sibling-based navigation if numbered pagination fails
    const fallbackNextButton = await page.evaluate(() => {
      const activePage = document.querySelector('.artdeco-pagination__indicator--number.active');
      if (activePage) {
        const nextSibling = activePage.parentElement.nextElementSibling;
        if (nextSibling) {
          const nextButton = nextSibling.querySelector('button');
          if (nextButton && !nextButton.disabled) {
            return nextButton.getAttribute('aria-label');
          }
        }
      }
      return null;
    });

    if (fallbackNextButton) {
      return `button[aria-label="${fallbackNextButton}"]`;
    }

    return null;
  } catch (error) {
    console.warn('Error finding next button:', error.message);
    return null;
  }
};

let previousJobs = new Set();

async function handleApplicationForm() {
  const buttonSelectors = {
    next: [
      'button[aria-label*="Next"]',
      'button[aria-label*="Continue"]',
      'button[aria-label*="Submit"]',
      'button.artdeco-button--primary',
      'div[class*="justify-flex-end"] button:last-child',
      'footer button:last-child'
    ],
    review: [
      'button[aria-label*="Review"]',
      'button:contains("Review")'
    ],
    submit: [
      'button[aria-label*="Submit"]',
      'button:contains("Submit")',
      'button.jobs-apply-button'
    ],
    dismiss: [
      '.artdeco-modal__dismiss',
      'button[aria-label="Dismiss"]',
      'button[aria-label="Close"]'
    ]
  };

  let formCompleted = false;
  let attempts = 0;
  const maxAttempts = 8;

  while (!formCompleted && attempts < maxAttempts) {
    try {
      await pause(2000);

      // Check if we're on the final submit screen
      const submitVisible = await page.evaluate((selectors) => {
        return selectors.submit.some(sel => {
          const btn = document.querySelector(sel);
          return btn && btn.offsetParent !== null;
        });
      }, buttonSelectors);

      if (submitVisible) {
        // Try each submit button
        for (const selector of buttonSelectors.submit) {
          if (await clickElement(selector, 3000)) {
            formCompleted = true;
            break;
          }
        }
        break;
      }

      // Try next/continue buttons
      let clicked = false;
      for (const selector of buttonSelectors.next) {
        if (await clickElement(selector, 3000)) {
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        // Check for review buttons if next not found
        for (const selector of buttonSelectors.review) {
          if (await clickElement(selector, 3000)) {
            clicked = true;
            break;
          }
        }
      }

      if (!clicked) {
        // If no actionable buttons found, form might be complete
        formCompleted = true;
        break;
      }

    } catch (error) {
      console.warn(`Form interaction attempt ${attempts + 1} failed:`, error.message);
    }
    attempts++;
  }

  // Handle any final dialogs
  await pause(2000);
  for (const selector of buttonSelectors.dismiss) {
    await clickElement(selector, 3000);
  }

  return formCompleted;
}

async function handleJobApplication() {
  try {
    const formSuccess = await handleApplicationForm();
    if (!formSuccess) {
      // Try to discard/dismiss if form wasn't completed
      const discardSelectors = [
        '[data-control-name="discard_application_confirm_btn"]',
        'button[aria-label="Dismiss"]',
        'button[aria-label="Cancel application"]',
        '.artdeco-modal__dismiss'
      ];
      
      for (const selector of discardSelectors) {
        await clickElement(selector, 3000);
      }
      return false;
    }
    return true;
  } catch (error) {
    console.error('Application error:', error.message);
    return false;
  }
}

const fillAndApply = async () => {
  const totalJobCount = await getTotalJobResult();
  let currentJobIndex = 1;
  let hasNextPage = true;
  let currentPage = 1;

  // Start page handling
  if (startPage > 1) {
    console.log(`\nNavigating to page ${startPage}...`);
    while (currentPage < startPage) {
      const nextButtonSelector = await getNextButton();
      if (nextButtonSelector) {
        await page.evaluate(() => {
          const pagination = document.querySelector('.artdeco-pagination');
          if (pagination) {
            pagination.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
        
        await pause(3000);
        
        try {
          await Promise.all([
            page.waitForNavigation({ 
              waitUntil: ['networkidle0', 'domcontentloaded'],
              timeout: 30000 
            }),
            page.click(nextButtonSelector)
          ]);
          
          await page.waitForFunction(
            (expectedPage) => {
              const active = document.querySelector('.artdeco-pagination__indicator--active');
              return active && parseInt(active.textContent.trim()) === expectedPage;
            },
            { timeout: 10000 },
            currentPage + 1
          );
          
          currentPage++;
          await pause(5000);
        } catch (error) {
          console.error('Failed to navigate to start page:', error.message);
          break;
        }
      } else {
        console.log('Could not find next page button');
        break;
      }
    }
    console.log(`Starting applications from page ${currentPage}`);
  }

  while (hasNextPage) {
    console.log(`\nProcessing page ${currentPage}`);
    await pause(3000);
    
    // Get current page job IDs to track duplicates
    const currentPageJobs = await page.evaluate(() => {
      const jobCards = document.querySelectorAll('.job-card-container');
      return Array.from(jobCards).map(card => card.getAttribute('data-job-id'));
    });

    // Check if we're seeing the same jobs
    const newJobs = currentPageJobs.filter(id => !previousJobs.has(id));
    if (newJobs.length === 0) {
      console.log('No new jobs found, ending search...');
      break;
    }

    // Add current jobs to tracking set
    currentPageJobs.forEach(id => previousJobs.add(id));

    for (let index = 0; index < numberOfJobsPerPage; index++) {
      if (currentJobIndex > totalJobCount) {
        console.log(`\n==========\n${t.endOfScript}.\n==========`);
        exit(0);
      }
      await Scrolling();

      console.log(`${t.jobNo} [${currentJobIndex} / ${totalJobCount}]`);
      currentJobIndex++;
      const activeJob = `[class*='jobs-search-two-pane__job-card-container--viewport-tracking-${index}']>div`;

      await clickElement(activeJob);

      await pause();
      //Check for application button
      const easyApplyButton = "[class*=jobs-apply-button]>button";
      if ((await page.$(easyApplyButton)) === null) {
        console.log(t.alreadyApplied);
        continue;
      }

      let companyName = await getCompanyName();
      const containsUnwantedCompanyName = avoidCompanies.some((name) =>
        companyName?.toLowerCase().includes(name?.toLowerCase())
      );

      if (containsUnwantedCompanyName) {
        console.log(`${t.skipCompany}: ${companyName}`);
        continue;
      }

      const jobTitle = await getJobTitle();
      const jobLink = await getLink();

      // Check if the job title is in the list of titles to avoid
      const jobTitleRegex = new RegExp(
        `\\b(${avoidJobTitles
          .map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|")})(?=\\b|[^a-zA-Z0-9])`,
        "i"
      );
      if (jobTitleRegex.test(jobTitle)) {
        console.log(`${t.skipTitle}: ${jobTitle}`);
        continue;
      }
      console.log(`${t.applyTo} ${jobTitle} ...`);

      await pause();
      const easyApplyLimitReached = await page.evaluate(() => {
        const easyApplyLimitEl = document.querySelector(
          ".artdeco-inline-feedback__message"
        );
        return easyApplyLimitEl && easyApplyLimitEl.innerText.includes("limit");
      });

      if (easyApplyLimitReached) {
        console.log(`==========\n${t.limit}...\n==========`);
        exit(0);
      }

      await clickElement(easyApplyButton);

      // Check to see if the "Job search safety reminder" dialog is displayed
      await pause();
      await page.evaluate(() => {
        const continueApplyingButton = document.querySelector(
          'div[class="artdeco-modal__actionbar ember-view job-trust-pre-apply-safety-tips-modal__footer"]>button+div>div>button'
        );
        if (continueApplyingButton) continueApplyingButton.click();
      });

      const isSingleStepApplication = await page.evaluate(() => {
        const submitOrNextBtn = document.querySelector(
          'div[class="display-flex justify-flex-end ph5 pv4"]>button'
        );
        if (submitOrNextBtn.innerText.toLowerCase().includes("submit")) {
          submitOrNextBtn.click();
          return true;
        }
        return false;
      });

      if (isSingleStepApplication) await closeJobApplicationDialog();

      let skipped = false;
      let firstPage = true;

      while (firstPage == true && !isSingleStepApplication) {
        if (
          await page.evaluate(() => {
            const nextBtn = document.querySelector(
              'div[class="display-flex justify-flex-end ph5 pv4"]>button'
            );
            if (nextBtn) nextBtn.click();
          })
        ) {
          firstPage = true;
        } else {
          firstPage = false;
          break;
        }
        await pause();
      }
      if (firstPage == false && !isSingleStepApplication) {
        const nextBtn =
          'div[class="display-flex justify-flex-end ph5 pv4"]>button + button';
        await clickElement(nextBtn);
        await pause();

        // Check for form fields and fill them
        await page.evaluate(() => {
          // Handle radio buttons and checkboxes
          const radioButtons = document.querySelectorAll('input[type="radio"]');
          radioButtons.forEach(radio => {
            const label = radio.labels?.[0]?.textContent.toLowerCase() || '';
            if (label.includes('yes') || label.includes('oui')) {
              radio.click();
            }
          });

          // Handle dropdowns
          const selects = document.querySelectorAll('select');
          selects.forEach(select => {
            const options = Array.from(select.options);
            // Try to find "Yes" option first
            const yesOption = options.find(opt => 
              opt.text.toLowerCase().includes('yes') ||
              opt.text.toLowerCase().includes('oui')
            );
            if (yesOption) {
              select.value = yesOption.value;
            } else {
              // If no "Yes" option, select the first non-empty option
              const firstValidOption = options.find(opt => opt.value);
              if (firstValidOption) {
                select.value = firstValidOption.value;
              }
            }
            select.dispatchEvent(new Event('change', { bubbles: true }));
          });

          // Handle text/number inputs
          const inputs = document.querySelectorAll('input[type="text"], input[type="number"]');
          inputs.forEach(input => {
            const label = input.labels?.[0]?.textContent.toLowerCase() || '';
            const placeholder = input.placeholder?.toLowerCase() || '';
            const ariaLabel = input.getAttribute('aria-label')?.toLowerCase() || '';
            let value = '';

            // Default to 5 years for experience-related fields
            if (label.includes('experience') || 
                label.includes('years') ||
                placeholder.includes('experience') ||
                placeholder.includes('years') ||
                ariaLabel.includes('experience') ||
                ariaLabel.includes('years')) {
              value = '5';
            }
            // Handle salary expectations
            else if (label.includes('salary') || 
                     placeholder.includes('salary') ||
                     ariaLabel.includes('salary')) {
              value = '85000';
            }
            // Handle other numeric fields
            else if (input.type === 'number') {
              value = '5';
            }
            // Handle text fields
            else {
              value = ' '; // Space character for required text fields
            }

            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              'value'
            ).set;
            nativeInputValueSetter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
        });

        await pause(1000);

        let counter = 30;
        let finalPage = false;
        do {
          await pause();
          const modalExists = await page.$(
            'div[class*="artdeco-modal-overlay"]>div>div+div>div>button>span'
          );
          if (!modalExists) {
            counter--;
            process.stdout.write(`\r${t.waiting}: ${counter}${t.remains}`);

            finalPage = await page.evaluate(() => {
              const nextButton = document.querySelector(
                'div[class="display-flex justify-flex-end ph5 pv4"]>button + button'
              );
              if (nextButton) {
                nextButton.click();
                return false;
              } else {
                return true;
              }
            });
          } else {
            counter = -2;
          }
        } while (counter > 0 && counter <= 30 && finalPage === false);

        if (finalPage === false) {
          // due to inactivity, skip the job
          await pause();
          await clickElement(
            ".artdeco-modal__dismiss.artdeco-button.artdeco-button--circle.artdeco-button--muted.artdeco-button--2.artdeco-button--tertiary.ember-view"
          );
          await pause();
          await clickElement(
            '[data-control-name="discard_application_confirm_btn"]'
          );
          skipped = true;
          console.log(`\n${t.jobSkipped}`);
        } else {
          await closeJobApplicationDialog();
        }
      } else {
        const applied = await handleJobApplication();
        if (!applied) {
          skipped = true;
          console.log(`\n${t.jobSkipped}`);
        }
      }
      // Add the Job to the CSV file
      writeInCSV({
        jobTitle: jobTitle,
        link: jobLink,
        status: skipped ? "Skipped" : "Applied",
      });
    }

    await Scrolling();
    const nextButtonSelector = await getNextButton();
    
    if (nextButtonSelector) {
      try {
        console.log("\nMoving to page " + (currentPage + 1));
        
        // Scroll to pagination area
        await page.evaluate(() => {
          const pagination = document.querySelector('.artdeco-pagination');
          if (pagination) {
            pagination.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
        
        await pause(2000);

        // Click and wait for navigation with more reliable checks
        try {
          await Promise.all([
            page.waitForNavigation({ 
              waitUntil: ['networkidle0', 'domcontentloaded'],
              timeout: 30000 
            }),
            page.click(nextButtonSelector)
          ]);

          // Verify page change was successful
          await page.waitForFunction(
            (expectedPage) => {
              const active = document.querySelector('.artdeco-pagination__indicator--active');
              return active && parseInt(active.textContent.trim()) === expectedPage;
            },
            { timeout: 10000 },
            currentPage + 1
          );

          currentPage++;
          hasNextPage = true;
          await pause(5000); // Allow more time for content to load
        } catch (navError) {
          console.log('Navigation error, retrying with alternate method...');
          // Fallback click method
          await page.evaluate((sel) => {
            const button = document.querySelector(sel);
            if (button) button.click();
          }, nextButtonSelector);
          await pause(8000); // Longer wait for fallback method
          currentPage++;
          hasNextPage = true;
        }
      } catch (error) {
        console.log('Error navigating to next page:', error.message);
        hasNextPage = false;
      }
    } else {
      console.log('\nNo more pages available');
      hasNextPage = false;
    }
  }
};

async function filterAndSearch() {
  try {
    await filterByKeywords();
    await pause(1000);
    await filterByLocation();
    await page.keyboard.press("Enter");
    await pause(2000);
    
    const easyApplySelector = await getEasyApplySelector();
    if (easyApplySelector) {
      await easyApplyFilter();
      await pause(1000);
    }
    
    await filterByTime();
    await pause(2000);
    await filterByType();
    await pause(2000);
  } catch (error) {
    console.error('Error in filterAndSearch:', error.message);
    // If filtering fails, try to continue with the search anyway
    console.log('Continuing with available search results...');
  }
}

async function main() {
  logs();
  await initializer();
  await login();
  await filterAndSearch();
  await fillAndApply();
  await browser.close();
}

main();
