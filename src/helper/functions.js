import { logger } from '../util/logging.js';
import { 
  getResource,
  getSQLVerb,
  getObjectKey,
  getMethodName,
} from '../config/tagging.js';
import { isParamRequired } from './reqparams.js';

/*
*  helper functions 
*/

function getOpParams(method, paramOrder, path, verb) {
    const inParams = method['parameters'];
    const paramList = [];
    for (const param of paramOrder) {
      if (param in inParams) {
        paramList.push({ ...inParams[param], name: param });
      }
    }
    for (const param in inParams) {
      if (!paramOrder.includes(param)) {
        paramList.push({ ...inParams[param], name: param });
      }
    }
    const paramListFinal = [];
    // add path params
    for (const token of path.split('/')) {
      if (token.startsWith('{')) {
        const finalParam = {};
        finalParam['in'] = 'path';
        finalParam['name'] = token.replace('{', '').replace('}', '').split(':')[0];
        finalParam['required'] = true;
        finalParam['schema'] = { type: 'string' };
        paramListFinal.push(finalParam);
      }
    }
    // add non path
    for (const param of paramList) {
      if (param['location'] !== 'path') {
        const finalParam = {};
        finalParam['in'] = param['location'];
        finalParam['name'] = param['name'];
        if ('required' in param) {
          finalParam['required'] = param['required'];
        } else {
          // check if required
          if(isParamRequired(path, param, verb)) {
            finalParam['required'] = true;
          }
        }
        finalParam['schema'] = { type: param['type'] };
        paramListFinal.push(finalParam);
      }
    }
    return paramListFinal;
}

function getResponse(respSchema) {
    return {
      '200': {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: {
              '$ref': `#/components/schemas/${respSchema}`,
            },
          },
        },
      },
    };
}

function getEmptyResponse() {
  return {
    '204': {
      description: 'No Content'
    }
  };
}
    
function getMethodScopes(obj) {
    const scopes = [];
    if ('scopes' in obj) {
      for (const scope of obj['scopes']) {
        scopes.push({
          Oauth2: [scope],
          Oauth2c: [scope],
        });
      }
    }
    return scopes;
}

function getValidPath(path) {
    if (path.startsWith('/')) {
      return path;
    } else {
      return `/${path}`;
    }
}
  
function processMethods(pathsObj, methodsObj, paramsRefList, debug) {
    for (const method in methodsObj) {
      debug ? logger.debug(`Processing method: ${method}...`) : null;
      let path;
      if ('flatPath' in methodsObj[method]) {
        path = getValidPath(methodsObj[method]['flatPath']);
      } else if ('path' in methodsObj[method]) {
        path = getValidPath(methodsObj[method]['path']);
      } else {
        throw new Error(`Method ${method} has no path`);
      }
      const verb = methodsObj[method]['httpMethod'].toLowerCase();
      let description;
      if ('description' in methodsObj[method]) {
        description = methodsObj[method]['description'];
      } else {
        description = '';
      }
      const operationId = methodsObj[method]['id'];
  
      // update path
      const version = path.split('/')[1];
      if (path.split('/').length > 2) {
        if (path.split('/')[2] === `{${version}Id}`) {
          path = getValidPath(methodsObj[method]['path'].split(':')[0]).replace('+', '');
        }
      }

      // fix for serviceusage, cloudasset, etc
      if (path.includes('{parent}')) {
        path = path.replace('{parent}', '{parentType}/{parent}');
      }
      
      if (!(path in pathsObj)) {
        debug ? logger.debug(`Adding ${path} path and global params...`) : null;
        pathsObj[path] = { parameters: paramsRefList };
      }
      
      debug ? logger.debug(`Adding ${verb} verb...`) : null;
      pathsObj[path][verb] = { description: description, operationId: operationId };
      if ('request' in methodsObj[method]) {
        const reqRef = methodsObj[method]['request']['$ref'];

        // wierd one with a datalineage post method...
        if(reqRef) {
          pathsObj[path][verb]['requestBody'] = {
            content: {
              'application/json': {
                schema: {
                  '$ref': `#/components/schemas/${reqRef}`,
                },
              },
            },
          };
        } else {
          logger.warn(`No req body for ${path}:${verb}...`)
        }
      }
      pathsObj[path][verb]['security'] = getMethodScopes(methodsObj[method]);
      if ('response' in methodsObj[method]) {
        pathsObj[path][verb]['responses'] = getResponse(methodsObj[method]['response']['$ref']);
      } else {
        pathsObj[path][verb]['responses'] = getEmptyResponse();
      }
      const parameterOrder = 'parameterOrder' in methodsObj[method] ? methodsObj[method]['parameterOrder'] : [];
      if ('parameters' in methodsObj[method]) {
        pathsObj[path][verb]['parameters'] = getOpParams(methodsObj[method], parameterOrder, path, verb);
      }
    }
    return pathsObj;
}
    
/*
*  exported functions 
*/

export function tagOperations(openapiDoc, service, debug) {
  const schemasObj = openapiDoc['components']['schemas'];
  for (const path of Object.keys(openapiDoc.paths)) {
    for (const verb of Object.keys(openapiDoc.paths[path])) {
      if (verb !== 'parameters') {    
        const operationId = openapiDoc.paths[path][verb].operationId;
        const operationObj = openapiDoc.paths[path][verb];
        const [resource, action] = getResource(service, operationId, debug);
        openapiDoc.paths[path][verb]['x-stackQL-resource'] = resource;
        openapiDoc.paths[path][verb]['x-stackQL-method'] = getMethodName(service, operationId, debug);
        openapiDoc.paths[path][verb]['x-stackQL-verb'] = getSQLVerb(service, resource, action, operationId, path, verb, operationObj, schemasObj, debug);
        // getObjectKey(openapiDoc, service, operationId, debug) ? openapiDoc.paths[path][verb]['x-stackQL-method'] = getObjectKey(openapiDoc, service, operationId, debug) : null;

        const objectKey = getObjectKey(openapiDoc, service, operationId, debug);

        if (objectKey) {
            openapiDoc.paths[path][verb]['x-stackQL-objectKey'] = objectKey;
        }
        
        // console.log(`resource: ${service}.${resource}`);
        // console.log(`operationId: ${operationId}`);
        // console.log(`method: ${getMethodName(service, operationId, debug)}`);
        // console.log(`verb: ${getSQLVerb(service, resource, action, operationId, path, verb, operationObj, schemasObj, debug)}`);

      }
    }
  }
  return openapiDoc;
}

export function populatePaths(pathsObj, obj, paramsRefList, debug) {
    for (const key in obj) {
      if (obj[key] instanceof Object) {
        if (key === 'methods') {
          pathsObj = processMethods(pathsObj, obj[key], paramsRefList, debug);
        }
        populatePaths(pathsObj, obj[key], paramsRefList, debug);
      } else if (Array.isArray(obj[key])) {
        for (const item of obj[key]) {
          if (item instanceof Object) {
            populatePaths(pathsObj, item, paramsRefList, debug);
          }
        }
      } else if (typeof obj[key] === 'string') {
        // do nothing
      }
    }
    return pathsObj;
  }
  
export function getCurrentDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function populateSecuritySchemes(authObj) {
    const securitySchemes = {};
    const scopesSource = authObj['oauth2']['scopes'];
    const scopesTarget = {};
    const authorizationUrl = 'https://accounts.google.com/o/oauth2/auth';
    const tokenUrl = 'https://accounts.google.com/o/oauth2/token';
  
    // reformat scopes
    for (const scope in scopesSource) {
      scopesTarget[scope] = scopesSource[scope]['description'];
    }
  
    // create implicit flow security scheme
    securitySchemes['Oauth2'] = {};
    securitySchemes['Oauth2']['type'] = 'oauth2';
    securitySchemes['Oauth2']['description'] = 'Oauth 2.0 implicit authentication';
    securitySchemes['Oauth2']['flows'] = {};
    securitySchemes['Oauth2']['flows']['implicit'] = {};
    securitySchemes['Oauth2']['flows']['implicit']['authorizationUrl'] = authorizationUrl;
    securitySchemes['Oauth2']['flows']['implicit']['scopes'] = scopesTarget;
  
    // create authorization code flow security scheme
    securitySchemes['Oauth2c'] = {};
    securitySchemes['Oauth2c']['type'] = 'oauth2';
    securitySchemes['Oauth2c']['description'] = 'Oauth 2.0 authorization code authentication';
    securitySchemes['Oauth2c']['flows'] = {};
    securitySchemes['Oauth2c']['flows']['authorizationCode'] = {};
    securitySchemes['Oauth2c']['flows']['authorizationCode']['authorizationUrl'] = authorizationUrl;
    securitySchemes['Oauth2c']['flows']['authorizationCode']['tokenUrl'] = tokenUrl;
    securitySchemes['Oauth2c']['flows']['authorizationCode']['scopes'] = scopesTarget;
  
    return securitySchemes;
  }

  export function replaceSchemaRefs(obj) {
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        replaceSchemaRefs(obj[key]);
      } else if (Array.isArray(obj[key])) {
        for (const item of obj[key]) {
          if (typeof item === 'object') {
            replaceSchemaRefs(item);
          }
        }
      } else if (typeof obj[key] === 'string') {
        if (key === '$ref') {
          obj[key] = `#/components/schemas/${obj[key]}`;
        }
      }
    }
    return obj;
  }

  export function processParameters(inputParams) {
    const paramsObj = {};
    const paramsRefList = [];
    for (const key in inputParams) {
      paramsRefList.push({ '$ref': `#/components/parameters/${key.replace('$.', '_.')}` });
  
      let schemaObj;
      if ('enum' in inputParams[key]) {
        schemaObj = {
          type: inputParams[key]['type'],
          enum: inputParams[key]['enum'],
        };
      } else {
        schemaObj = {
          type: inputParams[key]['type'],
        };
      }
  
      paramsObj[key.replace('$.', '_.')] = {
        description: inputParams[key]['description'],
        in: inputParams[key]['location'],
        name: key.replace('$.', '_.'),
        schema: schemaObj,
      };
    }
    return [paramsObj, paramsRefList];
  }