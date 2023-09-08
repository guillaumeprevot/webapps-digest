importScripts('./libs/forge/forge-custom-digest.min.js');

self.addEventListener('message', function(event) {
	digestFiles(event.data.files, event.data.checksums, event.data.defaultAlgorithm, event.data.compareValue);
});

// Firefox is fine with 64Ko slices when we call String.fromCharCode and is faster than with 32Ko slices.
// But Chrome and Edge throw an error with 64Ko slices while they accept 32Ko slices (empirical method)
// The digest algorithm will try 64Ko (to improve Firefox) and downgrade to 32Ko (if an error occurred on Chrome/Edge).
var sliceLength = 64 * 1024;

function digestFiles(files, checksums, defaultAlgorithm, compareValue) {
	if (!files || files.length == 0)
		return;

	const totalSize = [].reduce.call(files, (cumul, file) => cumul + file.size, 0);
	self.postMessage({ type: 'start' });
	digestFile(files, checksums, defaultAlgorithm, compareValue, totalSize, 0, 0);
}

function digestFile(files, checksums, defaultAlgorithm, compareValue, totalSize, doneSize, fileIndex) {
	const file = files[fileIndex];
	const url = URL.createObjectURL(file);
	fetch(url).then(function(response) {
		// Spec : https://streams.spec.whatwg.org/
		// MDN : https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/getReader
		const reader = response.body.getReader({ mode: "byob" });
		const checksum = checksums[file.name];
		const fileAlgorithm = checksum ? checksum.algorithm : defaultAlgorithm;
		const fileExpectedValue = checksum ? checksum.checksum : compareValue;
		const fileDigest = forge.md[fileAlgorithm].create();
		fileDigest.start();

		const bufferSize = 1024 * 1014 * 10; // 10Mo
		reader.read(new Uint8Array(bufferSize)).then(function process(data) {
			// "data" objects contain two properties:
			// done  - true if the stream has already given you all its data.
			// value - some Uint8Array. Always undefined when done is true.
			if (data.done) {
				var value = fileDigest.digest().toHex();
				self.postMessage({ type: 'result', file: file, algorithm: fileAlgorithm, hash: value, expectedHash: fileExpectedValue });
				fileIndex++;
				if (fileIndex < files.length)
					digestFile(files, checksums, defaultAlgorithm, compareValue, totalSize, doneSize, fileIndex);
				else {
					// DONE !
					self.postMessage({ type: 'stop' });
				}
				return;
			}

			// Update digest, 64Ko at a time
			for (var i = 0; i < data.value.byteLength; i += sliceLength) {
				try {
					//fileDigest.update(forge.util.binary.raw.encode(data.value.slice(i, i + sliceLength)));
					fileDigest.update(String.fromCharCode.apply(null, data.value.slice(i, i + sliceLength)));
				} catch (error) {
					console.log('An error occurred with a 64Ko buffer. Trying to switch to a 32Ko buffer.')
					self.postMessage({ type: 'error', message: 'An error occurred with a 64Ko buffer. Trying to switch to a 32Ko buffer.' });
					sliceLength = 32 * 1024;
					//fileDigest.update(forge.util.binary.raw.encode(data.value.slice(i, i + sliceLength)));
					fileDigest.update(String.fromCharCode.apply(null, data.value.slice(i, i + sliceLength)));
				}
				// Update progress
				self.postMessage({ type: 'progress', done: doneSize + i, total: totalSize });
				//console.log('progress', Math.round((doneSize + i + sliceLength) * 100 / totalSize));
			}

			// Include the whole chunk (data.value.byteLength)
			doneSize += data.value.byteLength;
			//console.log('next', doneSize);

			// Read some more, and call this function again
			return reader.read(new Uint8Array(data.value.buffer, 0, bufferSize)).then(process);

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
