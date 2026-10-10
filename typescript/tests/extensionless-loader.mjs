const RELATIVE = /^\.{1,2}\//;
const HAS_EXTENSION = /\.[cm]?js$|\.json$/;

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
}
