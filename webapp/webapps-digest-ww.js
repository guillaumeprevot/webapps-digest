importScripts('./libs/forge/forge-custom-digest.min.js');

self.addEventListener('message', function(event) {
	digest(event.data.files, event.data.checksums, event.data.defaultAlgorithm, event.data.compareValue);
});

function digest(files, checksums, defaultAlgorithm, compareValue) {
	if (!files || files.length == 0)
		return;
	
	var totalSize = [].reduce.call(files, function(cumul, file) { return cumul + file.size; }, 0),
		doneSize = 0,
		fileIndex = 0;

	function digestNextFile() {
		const file = files[fileIndex];
		const url = URL.createObjectURL(file);
		fetch(url).then(function(response) {
			// Spec : https://streams.spec.whatwg.org/
			// MDN : https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/getReader
			const reader = response.body.getReader();
			const checksum = checksums[file.name];
			const fileAlgorithm = checksum ? checksum.algorithm : defaultAlgorithm;
			const fileExpectedValue = checksum ? checksum.checksum : compareValue;
			const fileDigest = forge.md[fileAlgorithm].create();
			const sliceLength = 64 * 1024;
			fileDigest.start();
			reader.read().then(function process(data) {
				// "data" objects contain two properties:
				// done  - true if the stream has already given you all its data.
				// value - some Uint8Array. Always undefined when done is true.
				if (data.done) {
					var value = fileDigest.digest().toHex();
					self.postMessage({ type: 'result', file: file, algorithm: fileAlgorithm, hash: value, expectedHash: fileExpectedValue });
					fileIndex++;
					if (fileIndex < files.length)
						digestNextFile();
					else {
						// DONE !
						self.postMessage({ type: 'stop' });
					}
					return;
				}
	
				// Update digest, 64Ko at a time
				for (var i = 0; i < data.value.length; i += sliceLength) {
					//fileDigest.update(forge.util.binary.raw.encode(data.value.slice(i, i + sliceLength)));
					fileDigest.update(String.fromCharCode.apply(null, data.value.slice(i, i + sliceLength)));
					// Update progress
					self.postMessage({ type: 'progress', done: doneSize + i, total: totalSize });
					// console.log('progress', Math.round((doneSize + i + sliceLength) * 100 / totalSize));
				}
	
				// Include the whole chunk (data.value.length)
				doneSize += data.value.length;
				// console.log('next', doneSize);
	
				// Read some more, and call this function again
				return reader.read().then(process);
			}, function(error) {
				console.log('Erreur sur la lecture du fichier ' + file.name);
				console.log(error);
			});
			URL.revokeObjectURL(url)
		}, function(error) {
			console.log('Erreur sur la l\'ouverture du fichier ' + file.name);
			console.log(error);
		});
	}

	self.postMessage({ type: 'start' });
	digestNextFile();
}
