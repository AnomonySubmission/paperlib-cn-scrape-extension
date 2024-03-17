import parse from "node-html-parser";
import { PaperEntity } from "paperlib-api/model";
import { PLExtAPI } from "paperlib-api/api";

import { isEmpty } from "@/utils/string";
import { Scraper, ScraperRequestType } from "./scraper";

export class CNKIScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return !isEmpty(paperEntityDraft.title);
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://kns.cnki.net/kns/brief/GetGridTableHtml`;

    const headers = {
      Accept: "text/html, */*; q=0.01",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Host: "kns.cnki.net",
      Origin: "https://kns.cnki.net",
      Pragma: "no-cache",
      Referer: "https://kns.cnki.net/kns/defaultresult/index",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      "sec-ch-ua":
        '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    };

    return { scrapeURL, headers, sim_threshold: 0.95 };
  }

  static parsingProcess(rawResponse: string): PaperEntity[] {
    const html = parse(rawResponse);

    const results = html.querySelectorAll("tr")

    const candidatePaperEntityDrafts: PaperEntity[] = []

    for (const result of results) {
      let title = result.querySelector("td:nth-child(2)")?.querySelector("a")?.innerText.trim();
      if (!title) continue;
      const candidatePaperEntityDraft = new PaperEntity()
      candidatePaperEntityDraft.title = title;
      candidatePaperEntityDraft.authors = result.querySelector("td:nth-child(3)")?.innerText.trim().split(";").map((author) => author.trim()).filter(v => v).join(", ") || "";
      candidatePaperEntityDraft.publication = result.querySelector("td:nth-child(4)")?.innerText.trim() || "";
      candidatePaperEntityDraft.pubTime = result.querySelector("td:nth-child(5)")?.innerText.trim().substring(0, 4) || "";
      const typeStr = result.querySelector("td:nth-child(6)")?.innerText.trim();
      candidatePaperEntityDraft.pubType = typeStr === "期刊" ? 0 : typeStr === "会议" ? 1 : 2;

      candidatePaperEntityDrafts.push(candidatePaperEntityDraft);
    }

    return candidatePaperEntityDrafts;
  }

  static async scrape(
    paperEntityDraft: PaperEntity,
    force = false
  ): Promise<PaperEntity> {
    if (!this.checkEnable(paperEntityDraft) && !force) {
      return paperEntityDraft;
    }

    const { scrapeURL, headers, sim_threshold } =
      this.preProcess(paperEntityDraft);

    const queryJson = `{"Platform":"","DBCode":"CFLS","KuaKuCode":"CJFQ,CDMD,CIPD,CCND,CYFD,CCJD,BDZK,CISD,CJFQ,CDMD,CIPD,CCND,CYFD,CCJD,BDZK,CISD,CJFN","QNode":{"QGroup":[{"Key":"Subject","Title":"","Logic":1,"Items":[{"Title":"主题","Name":"SU","Value":"${paperEntityDraft.title} ${paperEntityDraft.authors.split(",").shift()?.trim() || ""}","Operate":"%=","BlurType":""}],"ChildItems":[]}]},"CodeLang":"ch"}`

    const data = {
      IsSearch: true,
      QueryJson: queryJson,
      PageName: "defaultresult",
      DBCode: "SCDB",
      KuaKuCodes:
        "CJFQ,CDMD,CIPD,CCND,CYFD,CCJD,BDZK,CISD,CJFQ,CDMD,CIPD,CCND,CYFD,CCJD,BDZK,CISD,CJFN",
      CurPage: 1,
      RecordsPerPage: 20,
      CurDisplayMode: "listmode",
      CurrSortField: "",
      CurrSortFieldType: "desc",
      IsSentenceSearch: false,
      Subject: "",
    };

    const formBody: string[] = [];
    for (var property in data) {
      var encodedKey = encodeURIComponent(property);
      var encodedValue = encodeURIComponent(data[property]);
      formBody.push(encodedKey + "=" + encodedValue);
    }
    const formBodyStr = formBody.join("&");

    const response = await PLExtAPI.networkTool.post(
      scrapeURL,
      formBodyStr,
      headers,
      1,
      10000,
      false,
    );

    const candidatePaperEntityDrafts = this.parsingProcess(response.body);

    const updatedPaperEntityDraft = this.matchingProcess(
      paperEntityDraft,
      candidatePaperEntityDrafts,
      sim_threshold
    );

    return updatedPaperEntityDraft;
  }
}
