import parse from "node-html-parser";
import { PaperEntity } from "paperlib-api/model";
import { PLAPI, PLExtAPI } from "paperlib-api/api";

import { isEmpty } from "@/utils/string";
import { Scraper, ScraperRequestType } from "./scraper";
import { stringUtils } from "paperlib-api/utils";

export class CNKIScraper extends Scraper {
  static checkEnable(paperEntityDraft: PaperEntity): boolean {
    return !isEmpty(paperEntityDraft.title);
  }

  static preProcess(paperEntityDraft: PaperEntity): ScraperRequestType {
    const scrapeURL = `https://kns.cnki.net/kns/brief/grid`;

    const headers = {
      Accept: "text/html, */*; q=0.01",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Host: "kns.cnki.net",
      Origin: "https://kns.cnki.net",
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

    const results = html.querySelectorAll("tr");

    const candidatePaperEntityDrafts: PaperEntity[] = [];

    for (const result of results) {
      let title = result
        .querySelector("td:nth-child(2)")
        ?.querySelector("a")
        ?.innerText.trim();

      if (!title) continue;
      const candidatePaperEntityDraft = new PaperEntity();
      candidatePaperEntityDraft.title = title;
      candidatePaperEntityDraft.authors =
        result
          .querySelector("td:nth-child(3)")
          ?.innerText.trim()
          .split(";")
          .map((v) => stringUtils.formatString({ str: v, removeNewline: true }))
          .map((v) => v.split(" ").filter((v) => v))
          .flat()
          .map((author) => author.trim())
          .filter((v) => v)
          .join(", ") || "";
      candidatePaperEntityDraft.publication =
        result.querySelector("td:nth-child(4)")?.innerText.trim() || "";
      candidatePaperEntityDraft.pubTime =
        result
          .querySelector("td:nth-child(5)")
          ?.innerText.trim()
          .substring(0, 4) || "";
      const typeStr = result.querySelector("td:nth-child(6)")?.innerText.trim();
      candidatePaperEntityDraft.pubType =
        typeStr === "期刊" ? 0 : typeStr === "会议" ? 1 : 2;

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

    // From Zotero jasminum
    const queryJson: any = {
      Platform: "",
      Resource: "CROSSDB",
      DBCode: "SCDB",
      KuaKuCode: "CJZK,CDFD,CMFD,CPFD,IPFD,CCND,BDZK,CPVD",
      QNode: {
        QGroup: [
          {
            Key: "Subject",
            Title: "",
            Logic: 0,
            Items: [],
            ChildItems: [], // fill up here
          },
          {
            Key: "ControlGroup",
            Title: "",
            Logic: 0,
            Items: [],
            ChildItems: [],
          },
        ],
      },
      ExScope: "1",
      SearchType: "0",
    };
    if (paperEntityDraft.authors) {
      const au = {
        Key: "",
        Title: "",
        Logic: 0,
        Items: [
          {
            Key: "",
            Title: "作者",
            Logic: 0,
            Field: "AU",
            Operator: "DEFAULT",
            Value: paperEntityDraft.authors,
            Value2: "",
          },
        ],
        ChildItems: [],
      };

      queryJson.QNode.QGroup[0].ChildItems.push(au);
    }
    const su = {
      Key: "",
      Title: "",
      Logic: 0,
      Items: [
        {
          Key: "",
          Title: "主题",
          Logic: 0,
          Field: "SU",
          Operator: "TOPRANK",
          Value: stringUtils.formatString({
            str: paperEntityDraft.title,
            removeSymbol: true,
          }),
          Value2: "",
        },
      ],
      ChildItems: [],
    };
    queryJson.QNode.QGroup[0].ChildItems.push(su);

    const data = {
      DBCode: "SCDB",
      pageNum: "1",
      pageSize: "20",
      sortField: "PT",
      sortType: "desc",
      boolSearch: "true",
      boolSortSearch: "false",
      version: "kns7",
      CurDisplayMode: "listmode",
      productStr: "CJZK,CDFD,CMFD,CPFD,IPFD,CCND,BDZK,CPVD",
      sentenceSearch: "false",
      aside: "空",
      QueryJson: JSON.stringify(queryJson),
    };

    const formBody: string[] = [];
    for (var property in data) {
      var encodedKey = encodeURIComponent(property);
      var encodedValue = encodeURIComponent(data[property]);
      formBody.push(encodedKey + "=" + encodedValue);
    }
    const formBodyStr = formBody.join("&");

    PLAPI.logService.info(scrapeURL, "", false, "CNKIScraper");
    PLAPI.logService.info(formBodyStr, "", false, "CNKIScraper");

    const response = await PLExtAPI.networkTool.post(
      scrapeURL,
      formBodyStr,
      headers,
      1,
      10000,
      false
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