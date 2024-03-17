import { PLAPI, PLExtAPI, PLExtension, PLMainAPI } from "paperlib-api/api";
import { PaperEntity } from "paperlib-api/model";

import { MetadataScrapeService } from "@/services/metadata-scrape-service";

interface IScraperPreference {
  type: "boolean";
  name: string;
  description: string;
  value: boolean;
}

class PaperlibCNScrapeExtension extends PLExtension {
  disposeCallbacks: (() => void)[];

  private readonly _metadataScrapeService: MetadataScrapeService;

  constructor() {
    super({
      id: "paperlib-cn-scrape-extension",
      defaultPreference: {
        "scraper-cnki": {
          type: "boolean",
          name: "CNKI",
          description: "知网",
          value: true,
          order: 1,
        },
      },
    });

    this._metadataScrapeService = new MetadataScrapeService();

    this.disposeCallbacks = [];
  }

  async initialize() {
    await PLExtAPI.extensionPreferenceService.register(
      this.id,
      this.defaultPreference,
    );

    this.disposeCallbacks.push(
      PLAPI.hookService.hookModify("scrapeMetadata", this.id, "scrapeMetadata"),
    );

    this._registerContextMenu();
  }

  async dispose() {
    for (const disposeCallback of this.disposeCallbacks) {
      disposeCallback();
    }
    PLExtAPI.extensionPreferenceService.unregister(this.id);
    PLMainAPI.contextMenuService.unregisterScraperExtension(this.id);
  }

  private _registerContextMenu() {
    const enabledScrapers: { [id: string]: string } = {};

    const scraperPref: Map<string, IScraperPreference> =
      PLExtAPI.extensionPreferenceService.getAllMetadata(this.id);

    for (const [id, pref] of scraperPref.entries()) {
      if (id.startsWith("scraper-") && pref.value) {
        enabledScrapers[id] = pref.name;
      }
    }

    PLMainAPI.contextMenuService.registerScraperExtension(
      this.id,
      enabledScrapers,
    );
  }

  async scrapeMetadata(
    paperEntityDrafts: PaperEntity[],
    specificScrapers: string[],
    force: boolean,
  ) {
    console.time("cnScrapeMetadata");
    if (paperEntityDrafts.length === 0) {
      console.timeEnd("cnScrapeMetadata");

      return [paperEntityDrafts, specificScrapers, force];
    }

    // Get enabled scrapers
    let scrapers: string[] = [];
    if (specificScrapers.length > 0) {
      scrapers = specificScrapers.filter((scraper) =>
        scraper.startsWith(this.id),
      );
      if (scrapers.length === 0) {
        console.timeEnd("cnScrapeMetadata");

        return [paperEntityDrafts, specificScrapers, force];
      } else {
        scrapers = scrapers.map((scraper) =>
          scraper.replace(`${this.id}-`, ""),
        );
      }
    } else {
      const scraperPref: Map<string, IScraperPreference> =
        PLExtAPI.extensionPreferenceService.getAllMetadata(this.id);

      for (const [id, pref] of scraperPref.entries()) {
        if (pref.value && id.startsWith("scraper-")) {
          scrapers.push(id);
        }
      }
    }
    scrapers = scrapers.map((scraper) => scraper.replace("scraper-", ""));

    const scrapedPaperEntityDrafts = await this._metadataScrapeService.scrape(
      paperEntityDrafts.map((paperEntityDraft) => {
        return new PaperEntity(paperEntityDraft);
      }),
      scrapers,
      force,
    );

    console.timeEnd("cnScrapeMetadata");

    return [scrapedPaperEntityDrafts, specificScrapers, force];
  }
}

async function initialize() {
  const extension = new PaperlibCNScrapeExtension();
  await extension.initialize();

  return extension;
}

export { initialize };
