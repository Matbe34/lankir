export namespace pdf {
	
	export class PDFMetadata {
	    title: string;
	    author: string;
	    subject: string;
	    creator: string;
	    pageCount: number;
	    filePath: string;
	
	    static createFrom(source: any = {}) {
	        return new PDFMetadata(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.author = source["author"];
	        this.subject = source["subject"];
	        this.creator = source["creator"];
	        this.pageCount = source["pageCount"];
	        this.filePath = source["filePath"];
	    }
	}
	export class PageInfo {
	    pageNumber: number;
	    width: number;
	    height: number;
	    imageData: string;
	
	    static createFrom(source: any = {}) {
	        return new PageInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pageNumber = source["pageNumber"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.imageData = source["imageData"];
	    }
	}
	export class RecentFile {
	    filePath: string;
	    fileName: string;
	    // Go type: time
	    lastOpened: any;
	    pageCount: number;
	
	    static createFrom(source: any = {}) {
	        return new RecentFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filePath = source["filePath"];
	        this.fileName = source["fileName"];
	        this.lastOpened = this.convertValues(source["lastOpened"], null);
	        this.pageCount = source["pageCount"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace signature {
	
	export class Certificate {
	    name: string;
	    issuer: string;
	    subject: string;
	    serialNumber: string;
	    validFrom: string;
	    validTo: string;
	    fingerprint: string;
	    source: string;
	    keyUsage: string[];
	    isValid: boolean;
	    nssNickname?: string;
	    pkcs11Url?: string;
	    pkcs11Module?: string;
	    filePath?: string;
	    canSign: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Certificate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.issuer = source["issuer"];
	        this.subject = source["subject"];
	        this.serialNumber = source["serialNumber"];
	        this.validFrom = source["validFrom"];
	        this.validTo = source["validTo"];
	        this.fingerprint = source["fingerprint"];
	        this.source = source["source"];
	        this.keyUsage = source["keyUsage"];
	        this.isValid = source["isValid"];
	        this.nssNickname = source["nssNickname"];
	        this.pkcs11Url = source["pkcs11Url"];
	        this.pkcs11Module = source["pkcs11Module"];
	        this.filePath = source["filePath"];
	        this.canSign = source["canSign"];
	    }
	}
	export class CertificateFilter {
	    Source: string;
	    Search: string;
	    ValidOnly: boolean;
	    IncludeCA: boolean;
	    MinKeyUsage: string;
	
	    static createFrom(source: any = {}) {
	        return new CertificateFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Source = source["Source"];
	        this.Search = source["Search"];
	        this.ValidOnly = source["ValidOnly"];
	        this.IncludeCA = source["IncludeCA"];
	        this.MinKeyUsage = source["MinKeyUsage"];
	    }
	}
	export class SignatureInfo {
	    signerName: string;
	    signerDN: string;
	    signingTime: string;
	    signingHashAlgorithm: string;
	    signatureType: string;
	    isValid: boolean;
	    certificateValid: boolean;
	    validationMessage: string;
	    certificateValidationMessage: string;
	    reason: string;
	    location: string;
	    contactInfo: string;
	
	    static createFrom(source: any = {}) {
	        return new SignatureInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.signerName = source["signerName"];
	        this.signerDN = source["signerDN"];
	        this.signingTime = source["signingTime"];
	        this.signingHashAlgorithm = source["signingHashAlgorithm"];
	        this.signatureType = source["signatureType"];
	        this.isValid = source["isValid"];
	        this.certificateValid = source["certificateValid"];
	        this.validationMessage = source["validationMessage"];
	        this.certificateValidationMessage = source["certificateValidationMessage"];
	        this.reason = source["reason"];
	        this.location = source["location"];
	        this.contactInfo = source["contactInfo"];
	    }
	}

}

