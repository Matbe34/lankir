export namespace config {
	
	export class Config {
	    theme: string;
	    accentColor: string;
	    defaultZoom: number;
	    showLeftSidebar: boolean;
	    showRightSidebar: boolean;
	    defaultViewMode: string;
	    recentFilesLength: number;
	    autosaveInterval: number;
	    certificateStores: string[];
	    tokenLibraries: string[];
	    debugMode: boolean;
	    hardwareAccel: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.accentColor = source["accentColor"];
	        this.defaultZoom = source["defaultZoom"];
	        this.showLeftSidebar = source["showLeftSidebar"];
	        this.showRightSidebar = source["showRightSidebar"];
	        this.defaultViewMode = source["defaultViewMode"];
	        this.recentFilesLength = source["recentFilesLength"];
	        this.autosaveInterval = source["autosaveInterval"];
	        this.certificateStores = source["certificateStores"];
	        this.tokenLibraries = source["tokenLibraries"];
	        this.debugMode = source["debugMode"];
	        this.hardwareAccel = source["hardwareAccel"];
	    }
	}

}

export namespace frontend {
	
	export class FileFilter {
	    DisplayName: string;
	    Pattern: string;
	
	    static createFrom(source: any = {}) {
	        return new FileFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.DisplayName = source["DisplayName"];
	        this.Pattern = source["Pattern"];
	    }
	}

}

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
	export class PageDimensions {
	    width: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new PageDimensions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.width = source["width"];
	        this.height = source["height"];
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
	    requiresPin: boolean;
	    pinOptional: boolean;
	
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
	        this.requiresPin = source["requiresPin"];
	        this.pinOptional = source["pinOptional"];
	    }
	}
	export class CertificateFilter {
	    Source: string;
	    Search: string;
	    ValidOnly: boolean;
	    RequiredKeyUsage: string;
	
	    static createFrom(source: any = {}) {
	        return new CertificateFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Source = source["Source"];
	        this.Search = source["Search"];
	        this.ValidOnly = source["ValidOnly"];
	        this.RequiredKeyUsage = source["RequiredKeyUsage"];
	    }
	}
	export class SignatureAppearance {
	    showSignerName: boolean;
	    showSigningTime: boolean;
	    showLocation: boolean;
	    showLogo: boolean;
	    logoPath?: string;
	    logoPosition?: string;
	    customText?: string;
	    fontSize: number;
	    backgroundColor?: string;
	    textColor?: string;
	
	    static createFrom(source: any = {}) {
	        return new SignatureAppearance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.showSignerName = source["showSignerName"];
	        this.showSigningTime = source["showSigningTime"];
	        this.showLocation = source["showLocation"];
	        this.showLogo = source["showLogo"];
	        this.logoPath = source["logoPath"];
	        this.logoPosition = source["logoPosition"];
	        this.customText = source["customText"];
	        this.fontSize = source["fontSize"];
	        this.backgroundColor = source["backgroundColor"];
	        this.textColor = source["textColor"];
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
	export class SignaturePosition {
	    page: number;
	    x: number;
	    y: number;
	    width: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new SignaturePosition(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.width = source["width"];
	        this.height = source["height"];
	    }
	}
	export class SignatureProfile {
	    id: number[];
	    name: string;
	    description: string;
	    visibility: string;
	    position: SignaturePosition;
	    appearance: SignatureAppearance;
	    isDefault: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SignatureProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.visibility = source["visibility"];
	        this.position = this.convertValues(source["position"], SignaturePosition);
	        this.appearance = this.convertValues(source["appearance"], SignatureAppearance);
	        this.isDefault = source["isDefault"];
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

